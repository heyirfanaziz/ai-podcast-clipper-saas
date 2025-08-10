"use server";

import { redirect } from "next/navigation";
import Stripe from "stripe";
import { env } from "~/env";
import { createSupabaseAdmin } from "~/lib/supabase-server";

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-05-28.basil",
});

export type PriceId = "small" | "medium" | "large";

const PRICE_IDS: Record<PriceId, string> = {
  small: env.STRIPE_SMALL_CREDIT_PACK,
  medium: env.STRIPE_MEDIUM_CREDIT_PACK,
  large: env.STRIPE_LARGE_CREDIT_PACK,
};

async function ensureUserProfile(userId: string) {
  console.log(`🔍 Ensuring user profile exists for: ${userId}`);
  
  // Use admin client for auth operations
  const supabaseAdmin = createSupabaseAdmin();
  
  // First, get the user info from Supabase auth
  const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);
  
  if (authError || !authUser.user) {
    console.error('❌ User not found in auth:', authError);
    throw new Error("User not found in authentication system");
  }
  
  const user = authUser.user;
  console.log(`📧 Found auth user: ${user.email}`);
  
  // Check if profile already exists
  const { data: existingProfile, error: checkError } = await supabaseAdmin
    .from('user_profiles')
    .select('id')
    .eq('id', userId)
    .single();
  
  if (existingProfile) {
    console.log(`✅ User profile already exists`);
    return existingProfile;
  }
  
  console.log(`🆕 Creating new user profile...`);
  
  // Create the user profile manually
  const { data: newProfile, error: createError } = await supabaseAdmin
    .from('user_profiles')
    .insert({
      id: userId,
      email: user.email,
      full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
      avatar_url: user.user_metadata?.avatar_url || null,
      credits: 100,
      daily_requests: 0,
      daily_limit: 20,
      concurrent_jobs: 0,
      concurrent_limit: 3,
      is_blocked: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  
  if (createError) {
    console.error('❌ Failed to create user profile:', createError);
    throw new Error("Failed to create user profile");
  }
  
  console.log(`✅ Created user profile successfully`);
  return newProfile;
}

export async function createCheckoutSession(priceId: PriceId, userId: string) {
  console.log(`🔍 Creating checkout session for user: ${userId}`);
  console.log(`🔍 User ID type: ${typeof userId}`);
  console.log(`🔍 User ID length: ${userId.length}`);
  
  const supabaseAdmin = createSupabaseAdmin();
  
  try {
    // Ensure user profile exists
    await ensureUserProfile(userId);
    
    // Now get the user profile
    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('stripe_customer_id, email, full_name, id')
      .eq('id', userId)
      .single();

    console.log(`🔍 Database query result:`, userProfile);
    console.log(`🔍 Database query error:`, profileError);

    if (profileError || !userProfile) {
      console.error('User profile not found:', profileError);
      throw new Error("User profile not found. Please refresh the page and try again.");
    }

    let stripeCustomerId = userProfile.stripe_customer_id;

    // Create Stripe customer if doesn't exist
    if (!stripeCustomerId) {
      console.log(`💳 Creating Stripe customer for: ${userProfile.email}`);
      
      const customer = await stripe.customers.create({
        email: userProfile.email,
        name: userProfile.full_name || undefined,
        metadata: {
          supabaseUserId: userId,
        },
      });

      stripeCustomerId = customer.id;
      console.log(`✅ Created Stripe customer: ${stripeCustomerId}`);

      // Update user profile with Stripe customer ID
      const { error: updateError } = await supabaseAdmin
        .from('user_profiles')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', userId);

      if (updateError) {
        console.error('Failed to update user with Stripe customer ID:', updateError);
        // Continue anyway, as the customer was created in Stripe
      }
    }

    console.log(`🛒 Creating Stripe checkout session...`);

    const session = await stripe.checkout.sessions.create({
      line_items: [{ price: PRICE_IDS[priceId], quantity: 1 }],
      customer: stripeCustomerId,
      mode: "payment",
      success_url: `${env.BASE_URL}/dashboard?success=true`,
      cancel_url: `${env.BASE_URL}/dashboard/billing`,
    });

    if (!session.url) {
      throw new Error("Failed to create session URL");
    }

    console.log(`✅ Stripe session created successfully, redirecting...`);
    redirect(session.url);
  } catch (error) {
    console.error('❌ Stripe checkout session error:', error);
    throw error;
  }
}
