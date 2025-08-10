import { inngest } from "./client";
import { createSupabaseAdmin } from "~/lib/supabase-server";
import { getRenderProgress } from "@remotion/lambda/client";
import { checkQueueHealth, REMOTION_REGIONS } from "~/lib/sqs-multi-region";

/**
 * Multi-Region Remotion Progress Monitor
 * Monitors render progress across all regions and SQS queues
 * Handles the new SQS-based multi-region architecture
 */
export const monitorMultiRegionProgress = inngest.createFunction(
  { id: "monitor-multi-region-progress", retries: 3 },
  { cron: "*/30 * * * *" }, // Run every 30 seconds
  async ({ step }) => {
    console.log("🌍 Monitoring multi-region Remotion render progress...");

    // Step 1: Check queue health across all regions
    const queueHealth = await step.run("check-queue-health", async () => {
      console.log("🔍 Checking queue health across all regions...");
      return await checkQueueHealth();
    });

    // Step 2: Check render progress for all clips
        return await step.run("check-render-progress", async () => {
      const supabase = createSupabaseAdmin();
      
      // Get all clips that are currently rendering or queued
      const { data: renderingClips, error } = await supabase
        .from('generated_clips')
        .select('*')
        .in('status', ['RENDERING', 'QUEUED_FOR_REMOTION']);

      if (error) {
        console.error("❌ Error fetching rendering clips:", error);
        throw error;
      }

      if (!renderingClips || renderingClips.length === 0) {
        console.log("✅ No clips currently rendering or queued");
        return { 
          message: "No clips currently rendering or queued",
          queueHealth
        };
      }

      console.log(`📊 Found ${renderingClips.length} clips in rendering pipeline`);

      const completedClips = [];
      const failedClips = [];
      const stillRenderingClips = [];
      const queuedClips = [];

      // Check progress for each clip
      for (const clip of renderingClips) {
        try {
          if (clip.status === 'QUEUED_FOR_REMOTION') {
            queuedClips.push(clip);
            continue;
          }

          console.log(`🔍 Checking progress for clip ${clip.id}...`);
          
          // Extract render ID and region from clip data
          const renderId = clip.render_id || clip.remotion_render_id;
          const region = clip.render_region || 'us-east-1'; // Default to us-east-1
          
          if (!renderId) {
            console.warn(`⚠️  No render ID found for clip ${clip.id}, marking as failed`);
            failedClips.push({
              ...clip,
              error: "No render ID found"
            });
            continue;
          }

          const progress = await getRenderProgress({
            renderId,
            bucketName: "ai-clipper-videos",
            functionName: "remotion-render-4-0-320-mem3008mb-disk2048mb-600sec",
            region,
          });

          console.log(`📈 Clip ${clip.id} progress: ${Math.round((progress.overallProgress || 0) * 100)}% (${region})`);

          if (progress.done) {
            if (progress.errors && progress.errors.length > 0) {
              console.error(`❌ Clip ${clip.id} failed with errors:`, progress.errors);
              failedClips.push({
                ...clip,
                error: progress.errors[0]?.message || "Unknown error"
              });
            } else {
              console.log(`✅ Clip ${clip.id} completed successfully in ${region}`);
              
                             // Convert S3 URL to R2 URL
               const s3Url = progress.outputFile;
               const r2Url = convertS3ToR2Url(s3Url || '');
              
              completedClips.push({
                ...clip,
                r2_final_url: r2Url,
                s3_final_url: s3Url,
                render_region: region
              });
            }
          } else {
            stillRenderingClips.push(clip);
          }
                 } catch (error) {
           console.error(`❌ Error checking progress for clip ${clip.id}:`, error);
           failedClips.push({
             ...clip,
             error: error instanceof Error ? error.message : String(error)
           });
         }
      }

      // Update completed clips
      if (completedClips.length > 0) {
        console.log(`✅ Updating ${completedClips.length} completed clips...`);
        
        for (const clip of completedClips) {
          const { error: updateError } = await supabase
            .from('clips')
            .update({
              status: 'COMPLETED',
              r2_final_url: clip.r2_final_url,
              s3_final_url: clip.s3_final_url,
              render_region: clip.render_region,
              updated_at: new Date().toISOString()
            })
            .eq('id', clip.id);

          if (updateError) {
            console.error(`❌ Error updating completed clip ${clip.id}:`, updateError);
          } else {
            console.log(`✅ Updated clip ${clip.id} to COMPLETED (${clip.render_region})`);
          }
        }
      }

      // Update failed clips
      if (failedClips.length > 0) {
        console.log(`❌ Updating ${failedClips.length} failed clips...`);
        
        for (const clip of failedClips) {
          const { error: updateError } = await supabase
            .from('clips')
            .update({
              status: 'FAILED',
              error_message: clip.error,
              updated_at: new Date().toISOString()
            })
            .eq('id', clip.id);

          if (updateError) {
            console.error(`❌ Error updating failed clip ${clip.id}:`, updateError);
          } else {
            console.log(`✅ Updated clip ${clip.id} to FAILED`);
          }
        }
      }

      // Check if all clips in any pipeline are completed
      await checkPipelineCompletion(supabase);

      // Log queue health summary
      const healthyRegions = Object.entries(queueHealth).filter(([_, health]) => health.available).length;
      const totalMessages = Object.values(queueHealth).reduce((sum, health) => sum + health.approximateMessages, 0);
      
      console.log(`🌍 Queue Health: ${healthyRegions}/${REMOTION_REGIONS.length} regions healthy, ${totalMessages} messages queued`);

      return {
        totalChecked: renderingClips.length,
        completed: completedClips.length,
        failed: failedClips.length,
        stillRendering: stillRenderingClips.length,
        queued: queuedClips.length,
        queueHealth: {
          healthyRegions,
          totalRegions: REMOTION_REGIONS.length,
          totalMessages
        }
      };
    });
  }
);

/**
 * Convert S3 URL to R2 public URL
 */
function convertS3ToR2Url(s3Url: string): string {
  if (!s3Url) return s3Url;
  
  // Extract the key from S3 URL
  const s3UrlPattern = /https:\/\/s3\.us-east-1\.amazonaws\.com\/ai-clipper-videos\/(.+)/;
  const match = s3Url.match(s3UrlPattern);
  
  if (match) {
    const key = match[1];
    return `https://pub-92b2f2f4576c47a6929f9f0b752833bc.r2.dev/${key}`;
  }
  
  return s3Url; // Return original if no match
}

/**
 * Check if all clips in a pipeline are completed
 */
async function checkPipelineCompletion(supabase: any) {
  console.log("🔍 Checking for completed pipelines...");
  
  try {
    // Get all pipelines with clips
    const { data: pipelines, error } = await supabase
      .from('clips')
      .select('pipeline_id')
      .not('pipeline_id', 'is', null);

    if (error) {
      console.error("❌ Error fetching pipelines:", error);
      return;
    }

         // Get unique pipeline IDs
     const uniquePipelineIds = [...new Set(pipelines.map((p: any) => p.pipeline_id))];
     
     console.log(`📊 Checking ${uniquePipelineIds.length} unique pipelines...`);

     for (const pipelineId of uniquePipelineIds) {
       // Get all clips for this pipeline
       const { data: pipelineClips, error: clipError } = await supabase
         .from('clips')
         .select('id, status')
         .eq('pipeline_id', pipelineId);

       if (clipError) {
         console.error(`❌ Error fetching clips for pipeline ${pipelineId}:`, clipError);
         continue;
       }

       if (!pipelineClips || pipelineClips.length === 0) {
         continue;
       }

       // Check if all clips are completed or failed
       const allCompleted = pipelineClips.every((clip: any) => 
         clip.status === 'COMPLETED' || clip.status === 'FAILED'
       );

       if (allCompleted) {
         const completedCount = pipelineClips.filter((clip: any) => clip.status === 'COMPLETED').length;
         const failedCount = pipelineClips.filter((clip: any) => clip.status === 'FAILED').length;
        
        console.log(`🎉 Pipeline ${pipelineId} completed: ${completedCount} successful, ${failedCount} failed`);
        
        // Send completion event
        await inngest.send({
          name: "pipeline.completed",
          data: {
            pipelineId,
            totalClips: pipelineClips.length,
            completedClips: completedCount,
            failedClips: failedCount,
            timestamp: new Date().toISOString()
          }
        });
      }
    }
  } catch (error) {
    console.error("❌ Error checking pipeline completion:", error);
  }
} 