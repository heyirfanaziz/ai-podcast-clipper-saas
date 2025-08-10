import { NextRequest, NextResponse } from "next/server";
import { inngest } from "~/inngest/client";
import { createSupabaseAdmin } from "~/lib/supabase-server";

/**
 * Webhook endpoint to receive Remotion render completion notifications
 * Called by the Lambda handler when a render finishes (success or failure)
 */
export async function POST(request: NextRequest) {
  try {
    console.log("🔔 Remotion completion webhook received");
    
    const webhookData = await request.json();
    console.log("📨 Webhook payload:", JSON.stringify(webhookData, null, 2));

    // Extract webhook data
    const {
      type, // 'success' or 'error'
      renderId,
      bucketName,
      customData
    } = webhookData;

    const {
      clipId,
      pipelineId,
      userId,
      clipIndex,
      outputKey
    } = customData || {};

    if (!clipId || !pipelineId || !userId) {
      console.error("❌ Missing required webhook data:", { clipId, pipelineId, userId });
      return NextResponse.json(
        { error: "Missing required webhook data" },
        { status: 400 }
      );
    }

    console.log(`🎬 Processing ${type} webhook for clip ${clipId} (${clipIndex})`);

    // Trigger Inngest function to handle completion
    const inngestResult = await inngest.send({
      name: "remotion.clip.completed",
      data: {
        type,
        renderId,
        bucketName,
        clipId,
        pipelineId,
        userId,
        clipIndex,
        outputKey,
        r2Url: type === 'success' ? `https://pub-92b2f2f4576c47a6929f9f0b752833bc.r2.dev/ai-clipper-videos/${outputKey}` : null,
        completedAt: new Date().toISOString(),
        webhookData
      }
    });

    console.log(`✅ Inngest event triggered: ${inngestResult.ids[0]}`);

    return NextResponse.json({
      success: true,
      message: `Clip ${clipId} completion processed`,
      inngestId: inngestResult.ids[0]
    });

  } catch (error) {
    console.error("❌ Webhook processing error:", error);
    
    return NextResponse.json(
      { 
        error: "Failed to process webhook",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
} 