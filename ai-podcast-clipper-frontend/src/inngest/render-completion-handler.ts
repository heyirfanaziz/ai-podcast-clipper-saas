import { inngest } from "./client";
import { createSupabaseAdmin } from "~/lib/supabase-server";
import { getRenderProgress } from "@remotion/lambda/client";
import { checkQueueHealth, REMOTION_REGIONS } from "~/lib/sqs-multi-region";

/**
 * Remotion Render Progress Monitor
 * Polls render progress and updates Supabase when completed
 * Based on the successful test-r2-render.js approach
 */
export const monitorRemotionProgress = inngest.createFunction(
  {
    id: "monitor-remotion-progress",
    name: "Monitor Remotion Render Progress",
    retries: 0,
    concurrency: { limit: 25 }, // Upgraded to Pro plan - full concurrency
  },
  { event: "remotion.progress.monitor" },
  async ({ event, step }) => {
    const { 
      renderId, 
      renderJobId, 
      clipId, 
      pipelineId, 
      outputKey,
      bucketName,
      functionName
    } = event.data;

    const supabase = createSupabaseAdmin();
    let progress: any;
    let attempts = 0;
    const maxAttempts = 36; // 10 minutes max (120 * 5 seconds)
    let finalStatus = "FAILED";
    let r2CdnUrl = null;
    let errorMsg = null;

    try {
      console.log(`🔍 Monitoring render progress for ${renderId}`);
      do {
        await step.sleep("progress-check-delay", "5s");
        attempts++;
        progress = await step.run(`check-progress-${attempts}`, async () => {
          try {
            const result = await getRenderProgress({
              renderId,
              bucketName,
              functionName,
              region: "us-east-1",
            });
            const progressPercent = Math.round((result.overallProgress || 0) * 100);
            console.log(`📈 Progress: ${progressPercent}% | Rendered: ${result.framesRendered || 0} frames`);
            if (renderJobId) {
              await supabase
                .from("render_jobs")
                .update({
                  remotion_progress: progressPercent,
                  updated_at: new Date().toISOString()
                })
                .eq("id", renderJobId);
            }
            if (result.errors && result.errors.length > 0) {
              console.error("❌ Render errors detected:");
              result.errors.forEach((error: any) => {
                console.error(`   - ${error.message}`);
              });
              if (renderJobId) {
                await supabase
                  .from("render_jobs")
                  .update({
                    remotion_status: "failed",
                    error_message: result.errors.map((e: any) => e.message).join("; "),
                    render_completed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                  })
                  .eq("id", renderJobId);
              }
              await supabase
                .from("generated_clips")
                .update({
                  status: "FAILED",
                  updated_at: new Date().toISOString()
                })
                .eq("id", clipId);
              errorMsg = result.errors.map((e: any) => e.message).join("; ");
              throw new Error(`Render failed: ${errorMsg}`);
            }
            return result;
          } catch (error) {
            console.error(`❌ Progress check failed:`, error);
            if (error instanceof Error && (error.message.includes("Rate Exceeded") || error.message.includes("Too Many Requests"))) {
              console.log("⏳ Rate limit hit, waiting longer...");
              await new Promise(resolve => setTimeout(resolve, 10000));
              throw error;
            }
            throw error;
          }
        });
        if (attempts >= maxAttempts) {
          errorMsg = `Render monitoring timed out after ${maxAttempts} attempts`;
          throw new Error(errorMsg);
        }
      } while (progress?.done === false);

      // Handle completion
      await step.run("handle-completion", async () => {
        if (progress?.done && !progress?.errors?.length) {
          finalStatus = "COMPLETED";
          const r2PublicAccountId = "92b2f2f4576c47a6929f9f0b752833bc";
          
          // Extract the correct path from the output
          let finalOutputKey = outputKey; // fallback to original outputKey
          
          if (progress.outputFile) {
            // If outputFile is a full S3 URL, extract just the key part
            if (progress.outputFile.includes('s3.us-east-1.amazonaws.com')) {
              // Extract path after bucket name: s3.us-east-1.amazonaws.com/ai-clipper-videos/users-data/...
              const match = progress.outputFile.match(/s3\.us-east-1\.amazonaws\.com\/ai-clipper-videos\/(.+)/);
              if (match) {
                finalOutputKey = match[1];
              } else {
                console.warn(`⚠️ Could not parse S3 URL: ${progress.outputFile}, using fallback`);
              }
            } else if (progress.outputFile.startsWith('/')) {
              // If it's just a path, remove leading slash
              finalOutputKey = progress.outputFile.substring(1);
            } else {
              // Use as-is if it looks like a key
              finalOutputKey = progress.outputFile;
            }
          }
          
          r2CdnUrl = `https://pub-${r2PublicAccountId}.r2.dev/${finalOutputKey}`;
          console.log(`📁 Lambda progress object:`, progress);
          console.log(`📁 Original outputFile: ${progress.outputFile}`);
          console.log(`📁 Extracted key: ${finalOutputKey}`);
          console.log(`🌐 Public URL: ${r2CdnUrl}`);
          if (renderJobId) {
            await supabase
              .from("render_jobs")
              .update({
                remotion_status: "completed",
                remotion_progress: 100,
                render_completed_at: new Date().toISOString(),
                output_r2_url: r2CdnUrl,
                updated_at: new Date().toISOString()
              })
              .eq("id", renderJobId);
          }
          await supabase
            .from("generated_clips")
            .update({
              status: "COMPLETED",
              r2_final_url: r2CdnUrl,
              updated_at: new Date().toISOString()
            })
            .eq("id", clipId);
          console.log(`✅ Clip ${clipId} completed and synced to Supabase`);
        } else {
          finalStatus = "FAILED";
          errorMsg = progress?.errors?.[0]?.message || "Render failed or had errors";
          await supabase
            .from("generated_clips")
            .update({
              status: "FAILED",
              updated_at: new Date().toISOString()
            })
            .eq("id", clipId);
          console.warn(`❌ Clip ${clipId} failed: ${errorMsg}`);
        }
      });
    } catch (err) {
      // On any unexpected error, mark as failed and log
      errorMsg = err instanceof Error ? err.message : String(err);
      await supabase
        .from("generated_clips")
        .update({
          status: "FAILED",
          updated_at: new Date().toISOString()
        })
        .eq("id", clipId);
      console.error(`❌ Unexpected error for clip ${clipId}:`, errorMsg);
    } finally {
      // Always send completion event for the sequential workflow to catch
      await inngest.send({
        name: "remotion.render.complete",
        data: {
          renderId,
          status: finalStatus === "COMPLETED" ? "success" : "failed",
          error: errorMsg,
          clipId,
          pipelineId,
          r2_final_url: r2CdnUrl,
        },
      });
      // Optionally, check pipeline completion
      await checkPipelineCompletion(pipelineId);
    }
    return { success: finalStatus === "COMPLETED", renderId, finalUrl: r2CdnUrl };
  }
);

/**
 * Check if all clips in a pipeline are completed and update pipeline status
 */
async function checkPipelineCompletion(pipelineId: string) {
  const supabase = createSupabaseAdmin();
  
  try {
    const { data: clips, error: countError } = await supabase
      .from("generated_clips")
      .select("status", { count: "exact" })
      .eq("pipeline_id", pipelineId);
      
    if (countError) {
      console.error(`Failed to check clip count:`, countError);
      return;
    }
    
    const totalClips = clips?.length || 0;
    const completedClips = clips?.filter(c => c.status === "COMPLETED")?.length || 0;
    const failedClips = clips?.filter(c => c.status === "FAILED")?.length || 0;
    
    console.log(`📊 Pipeline ${pipelineId}: ${completedClips}/${totalClips} completed, ${failedClips} failed`);
    
    if (completedClips + failedClips === totalClips) {
      // All clips are either completed or failed
      await supabase
        .from("pipelines")
        .update({
          status: "COMPLETED",
          phase3_completed_at: new Date().toISOString(),
          successful_clips: completedClips,
          failed_clips: failedClips,
          updated_at: new Date().toISOString()
        })
        .eq("id", pipelineId);
        
      console.log(`🎉 Pipeline ${pipelineId} completed with ${completedClips} successful and ${failedClips} failed clips`);
    }
  } catch (error) {
    console.error("Error checking pipeline completion:", error);
  }
} 