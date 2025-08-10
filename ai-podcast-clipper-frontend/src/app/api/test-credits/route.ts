import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdmin } from "~/lib/supabase-server";

export async function POST(request: NextRequest) {
  try {
    const { userId, creditsToAdd } = await request.json();
    
    console.log("🧪 TEST: Adding credits manually", { userId, creditsToAdd });
    
    const supabaseAdmin = createSupabaseAdmin();
    
    // Get current user credits
    const { data: userProfile, error: getUserError } = await supabaseAdmin
      .from('user_profiles')
      .select('credits, email, id, total_credits_used')
      .eq('id', userId)
      .single();

    if (getUserError || !userProfile) {
      console.error('❌ User not found:', userId, getUserError);
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const oldCredits = userProfile.credits || 0;
    const newCredits = oldCredits + creditsToAdd;
    
    console.log("🧪 TEST: Credit calculation", {
      oldCredits,
      creditsToAdd,
      newCredits
    });

    // Update user credits
    const { error: updateError, data: updatedProfile } = await supabaseAdmin
      .from('user_profiles')
      .update({
        credits: newCredits,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select();

    if (updateError) {
      console.error('❌ Failed to update credits:', updateError);
      return NextResponse.json({ error: "Failed to update credits" }, { status: 500 });
    }

    console.log("✅ TEST: Credits updated successfully", {
      oldCredits,
      newCredits,
      actualNewCredits: updatedProfile?.[0]?.credits
    });
    
    return NextResponse.json({
      success: true,
      oldCredits,
      newCredits,
      actualNewCredits: updatedProfile?.[0]?.credits
    });
    
  } catch (error) {
    console.error("❌ TEST: Error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
} 