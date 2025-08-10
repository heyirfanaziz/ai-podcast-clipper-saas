import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "~/lib/supabase-server";

export async function POST(req: Request) {
  console.log("🔧 ===== FIXING CUSTOMER ID =====");
  
  try {
    const { userId } = await req.json();
    
    console.log(`🎯 Clearing stale customer ID for user: ${userId}`);
    
    const supabaseAdmin = createSupabaseAdmin();
    
    // Clear the stale Stripe customer ID
    const { error: updateError, data: updatedProfile } = await supabaseAdmin
      .from('user_profiles')
      .update({ stripe_customer_id: null })
      .eq('id', userId)
      .select('id, email, stripe_customer_id');

    if (updateError) {
      console.error('❌ Update failed:', updateError);
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }

    console.log(`✅ Customer ID cleared successfully`);
    
    return NextResponse.json({ 
      success: true, 
      userId,
      message: "Stale customer ID cleared. Next purchase will create a fresh customer."
    });
    
  } catch (error) {
    console.error("❌ Fix customer error:", error);
    return NextResponse.json({ error: "Fix failed" }, { status: 500 });
  }
} 