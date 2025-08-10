import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "~/lib/supabase-server";

export async function POST(req: Request) {
  console.log("💳 ===== CREDIT DEDUCTION =====");
  
  try {
    const { userId, credits, reason } = await req.json();
    
    console.log(`🎯 Deducting credits for user: ${userId}`);
    console.log(`➖ Credits to deduct: ${credits}`);
    console.log(`📝 Reason: ${reason}`);
    
    const supabaseAdmin = createSupabaseAdmin();
    
    // Get current user credits
    const { data: userProfile, error: getUserError } = await supabaseAdmin
      .from('user_profiles')
      .select('id, email, credits, total_credits_used')
      .eq('id', userId)
      .single();

    if (getUserError || !userProfile) {
      console.error('❌ User not found:', getUserError);
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const currentCredits = userProfile.credits || 0;
    
    // Check if user has enough credits
    if (currentCredits < credits) {
      console.error(`❌ Insufficient credits: ${currentCredits} < ${credits}`);
      return NextResponse.json({ 
        error: "Insufficient credits",
        currentCredits,
        requiredCredits: credits
      }, { status: 400 });
    }

    const newCredits = currentCredits - credits;
    
    console.log(`📊 Current: ${currentCredits}, Deducting: ${credits}, New: ${newCredits}`);

    // Update credits
    const { error: updateError, data: updatedProfile } = await supabaseAdmin
      .from('user_profiles')
      .update({ 
        credits: newCredits,
        total_credits_used: (userProfile.total_credits_used || 0) + credits
      })
      .eq('id', userId)
      .select('credits, total_credits_used');

    if (updateError) {
      console.error('❌ Deduction failed:', updateError);
      return NextResponse.json({ error: "Deduction failed" }, { status: 500 });
    }

    console.log(`✅ Credits deducted successfully`);
    console.log(`📊 New credits: ${updatedProfile?.[0]?.credits}`);
    console.log(`📈 Total used: ${updatedProfile?.[0]?.total_credits_used}`);
    
    return NextResponse.json({ 
      success: true, 
      oldCredits: currentCredits, 
      newCredits: updatedProfile?.[0]?.credits,
      totalUsed: updatedProfile?.[0]?.total_credits_used,
      reason
    });
    
  } catch (error) {
    console.error("❌ Credit deduction error:", error);
    return NextResponse.json({ error: "Deduction failed" }, { status: 500 });
  }
} 