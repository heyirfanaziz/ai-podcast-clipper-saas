// stripe listen --forward-to localhost:3001/api/webhooks/stripe

import { NextResponse } from "next/server";
import Stripe from "stripe";
import { env } from "~/env";
import { createSupabaseAdmin } from "~/lib/supabase-server";

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-05-28.basil",
});

const webhookSecret = env.STRIPE_WEBHOOK_SECRET;

export async function POST(req: Request) {
  console.log("🔔 ===== STRIPE WEBHOOK RECEIVED =====");
  console.log("🕐 Timestamp:", new Date().toISOString());
  
  try {
    const body = await req.text();
    const signature = req.headers.get("stripe-signature") ?? "";

    console.log("📝 Webhook body length:", body.length);
    console.log("🔏 Webhook signature:", signature ? "present" : "missing");

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
      console.log("✅ Webhook signature verified successfully");
      console.log("📦 Event type:", event.type);
      console.log("🆔 Event ID:", event.id);
    } catch (error) {
      console.error("❌ Webhook signature verification failed", error);
      return new NextResponse("Webhook signature verification failed", {
        status: 400,
      });
    }

    if (event.type === "checkout.session.completed") {
      console.log("💳 ===== PROCESSING CHECKOUT COMPLETED =====");
      
      const session = event.data.object;
      const customerId = session.customer as string;
      
      console.log("🔍 Session details:", {
        sessionId: session.id,
        customerId,
        amount: session.amount_total,
        currency: session.currency,
        mode: session.mode,
        status: session.status
      });

      // Check if session has line_items already (for test events)
      let lineItems = (session as any).line_items;
      
      if (!lineItems) {
        console.log("📄 No line_items in session, retrieving from Stripe...");
        try {
          // Get session with line items
          const retrievedSession = await stripe.checkout.sessions.retrieve(
        session.id,
            { expand: ["line_items", "line_items.data.price"] },
      );
          lineItems = retrievedSession.line_items;
          console.log("📄 Retrieved line items:", {
            id: retrievedSession.id,
            customer: retrievedSession.customer,
            line_items_count: lineItems?.data.length || 0
          });
        } catch (retrieveError) {
          console.error("❌ Failed to retrieve session:", retrieveError);
          // For test events, try to determine credits from amount
          const amount = session.amount_total || 0;
          let creditsToAdd = 0;
          if (amount === 999) creditsToAdd = 50;      // $9.99 = small pack
          else if (amount === 2499) creditsToAdd = 150; // $24.99 = medium pack  
          else if (amount === 6999) creditsToAdd = 500; // $69.99 = large pack
          
          if (creditsToAdd > 0) {
            console.log(`💎 Determined credits from amount: ${amount} cents = ${creditsToAdd} credits`);
            await addCreditsToUser(customerId, creditsToAdd, session.id, 'amount-based');
            console.log("✅ ===== WEBHOOK PROCESSED SUCCESSFULLY =====");
            return new NextResponse(null, { status: 200 });
          } else {
            console.error("❌ Cannot determine credits from amount:", amount);
            return new NextResponse("Cannot determine credits", { status: 400 });
          }
        }
      }

      if (lineItems && lineItems.data && lineItems.data.length > 0) {
        const firstLineItem = lineItems.data[0];
        const priceId = firstLineItem?.price?.id;
        
        console.log("💰 Line item details:", {
          priceId,
          quantity: firstLineItem?.quantity,
          amount: firstLineItem?.amount_total,
          description: firstLineItem?.description
        });

        if (priceId) {
          // Determine credits to add based on price ID
          let creditsToAdd = 0;
          if (priceId === env.STRIPE_SMALL_CREDIT_PACK) {
            creditsToAdd = 50;
            console.log("💎 Matched SMALL pack (50 credits)");
          } else if (priceId === env.STRIPE_MEDIUM_CREDIT_PACK) {
            creditsToAdd = 150;
            console.log("💎 Matched MEDIUM pack (150 credits)");
          } else if (priceId === env.STRIPE_LARGE_CREDIT_PACK) {
            creditsToAdd = 500;
            console.log("💎 Matched LARGE pack (500 credits)");
          } else {
            console.error("❌ UNKNOWN PRICE ID:", priceId);
            return new NextResponse("Unknown price ID", { status: 400 });
          }

          console.log(`🔢 Credits to add: ${creditsToAdd}`);
          await addCreditsToUser(customerId, creditsToAdd, session.id, priceId);
          
        } else {
          console.log("⚠️ No price ID found in line items");
        }
      } else {
        console.log("⚠️ No line items found in session");
      }
    } else {
      console.log(`ℹ️ Ignoring event type: ${event.type}`);
    }

    console.log("✅ ===== WEBHOOK PROCESSED SUCCESSFULLY =====");
    return new NextResponse(null, { status: 200 });
  } catch (error) {
    console.error("❌ ===== WEBHOOK ERROR =====");
    console.error("❌ Error processing webhook:", error);
    return new NextResponse("Webhook error", { status: 500 });
  }
}

async function addCreditsToUser(customerId: string, creditsToAdd: number, sessionId: string, priceId: string) {
  // Use Supabase admin client
  const supabaseAdmin = createSupabaseAdmin();
  
  console.log("🔍 ===== LOOKING UP USER =====");
  console.log("👤 Searching for customer ID:", customerId);
  
  // Find user by Stripe customer ID
  const { data: userProfile, error: getUserError } = await supabaseAdmin
    .from('user_profiles')
    .select('id, email, credits, stripe_customer_id')
    .eq('stripe_customer_id', customerId)
    .single();

  console.log("👤 User lookup result:", {
    found: !!userProfile,
    error: getUserError?.message,
    userId: userProfile?.id,
    email: userProfile?.email,
    currentCredits: userProfile?.credits
  });

  if (getUserError || !userProfile) {
    console.error('❌ ===== USER NOT FOUND =====');
    console.error('❌ Customer ID:', customerId);
    console.error('❌ Error:', getUserError);
    throw new Error("User not found");
  }

  const oldCredits = userProfile.credits || 0;
  const newCredits = oldCredits + creditsToAdd;
  
  console.log(`💳 ===== CREDIT UPDATE =====`);
  console.log(`📊 Current credits: ${oldCredits}`);
  console.log(`➕ Credits to add: ${creditsToAdd}`);
  console.log(`🎯 New total: ${newCredits}`);
  console.log(`👤 User: ${userProfile.email} (${userProfile.id})`);

  // Update user credits - SAME LOGIC AS SUCCESSFUL TEST
  const { error: updateError, data: updatedProfile } = await supabaseAdmin
    .from('user_profiles')
    .update({ credits: newCredits })
    .eq('id', userProfile.id)
    .select('id, email, credits');

  if (updateError) {
    console.error('❌ ===== CREDIT UPDATE FAILED =====');
    console.error('❌ Update error:', updateError);
    throw new Error("Failed to update credits");
  }

  console.log(`✅ ===== CREDITS UPDATED SUCCESSFULLY =====`);
  console.log(`📊 Update result:`, {
    userId: userProfile.id,
    email: userProfile.email,
    oldCredits,
    newCredits: updatedProfile?.[0]?.credits,
    creditsAdded: creditsToAdd,
    priceId,
    sessionId: sessionId,
    timestamp: new Date().toISOString()
  });
}
