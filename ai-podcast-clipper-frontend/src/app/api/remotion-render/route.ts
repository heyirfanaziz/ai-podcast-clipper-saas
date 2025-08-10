import { NextRequest, NextResponse } from "next/server";
import { calculateOptimalFramesPerLambda } from "~/inngest/utils/frames-calculator";

export async function POST(request: NextRequest) {
  try {
    // Use AWS SDK for direct Lambda invocation
    const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");

    const body = await request.json();
    const {
      videoUrl,
      subtitleUrl,
      duration,
      outputKey,
      framesPerLambda: providedFramesPerLambda,
      fontFamily = "anton"
    } = body;

    // Recalculate frames per lambda to ensure concurrency limits are respected
    const frameCalc = calculateOptimalFramesPerLambda(duration, 30, 10);
    const framesPerLambda = frameCalc.framesPerLambda;

    console.log(`🧮 API Route Frame calculation:`, {
      duration,
      providedFramesPerLambda,
      calculatedFramesPerLambda: frameCalc.framesPerLambda,
      estimatedLambdas: frameCalc.estimatedLambdaCount,
      concurrencyRespected: frameCalc.concurrencyRespected,
      reasoning: frameCalc.reasoning
    });

    // Create Lambda client with Remotion credentials
    const lambdaClient = new LambdaClient({
      region: "us-east-1",
      credentials: {
        accessKeyId: process.env.REMOTION_AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.REMOTION_AWS_SECRET_ACCESS_KEY!,
      },
    });

    // Create payload for Remotion Lambda
    const payload = {
      type: "start",
      serveUrl: "https://remotionlambda-useast1-m9vorb5nmi.s3.us-east-1.amazonaws.com/sites/tiktok-processor-v2/index.html",
      composition: "CaptionedVideo",
      inputProps: {
        videoUrl,
        subtitleUrl,
        durationInSeconds: duration,
        highlightColor: "#39E508",
        backgroundColor: "#FFFFFF",
        captionSpeed: "medium",
        fontSize: 120,
        fontFamily,
      },
      codec: "h264",
      framesPerLambda,
      concurrencyPerLambda: 1,
      maxRetries: 2,
      timeoutInMilliseconds: 600000,
      audioCodec: "mp3",
      imageFormat: "jpeg",
      jpegQuality: 100,
      privacy: "public",
      outName: {
        bucketName: "ai-clipper-videos",
        key: outputKey,
        s3OutputProvider: {
          endpoint: "https://cd3dd24bd9991cd4300824929326a9de.r2.cloudflarestorage.com",
          accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
          secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!
        }
      }
    };

    // Invoke Remotion Lambda
    const command = new InvokeCommand({
      FunctionName: "remotion-render-4-0-320-mem3008mb-disk2048mb-600sec",
      InvocationType: "RequestResponse",
      Payload: JSON.stringify(payload),
    });

    const response = await lambdaClient.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.Payload));

    if (result.type !== "success") {
      throw new Error(`Lambda execution failed: ${result.message || 'Unknown error'}`);
    }

    return NextResponse.json({
      success: true,
      renderId: result.renderId
    });

  } catch (error) {
    console.error("Remotion render failed:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
} 