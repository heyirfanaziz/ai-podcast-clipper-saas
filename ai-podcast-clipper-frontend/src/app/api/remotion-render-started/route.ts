import { NextRequest, NextResponse } from "next/server";
import { inngest } from "~/inngest/client";

/**
 * API endpoint for AWS Lambda to notify when a Remotion render starts
 * This triggers the monitoring workflow
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    const { 
      renderId, 
      clipId, 
      pipelineId, 
      outputKey,
      bucketName = "ai-clipper-videos",
      functionName = "ai-clipper-render"
    } = body;

    // Validate required fields
    if (!renderId || !clipId || !pipelineId) {
      return NextResponse.json({
        success: false,
        error: "Missing required fields: renderId, clipId, pipelineId"
      }, { status: 400 });
    }

    console.log(`🎬 Render started notification received`, {
      renderId,
      clipId,
      pipelineId,
      outputKey
    });

    // Trigger the render started event
    await inngest.send({
      name: "remotion.render.started",
      data: {
        renderId,
        clipId,
        pipelineId,
        outputKey,
        bucketName,
        functionName
      }
    });

    console.log(`✅ Monitoring triggered for render ${renderId}`);

    return NextResponse.json({
      success: true,
      message: "Monitoring triggered successfully",
      renderId,
      clipId
    });

  } catch (error) {
    console.error("❌ Failed to handle render started notification:", error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
} 