/**
 * Production Inngest Functions
 * Handles 1000 requests/day with intelligent queue management
 */

import { inngest } from "./client";
import { NonRetriableError } from "inngest";
import { env } from "../env";
import { calculateOptimalFramesPerLambda } from "./utils/frames-calculator";

// Types
interface ClipProcessingEvent {
  run_id: string;
  user_id: string;
  clips: Array<{
    clip_index: number;
    r2_video_url: string;
    r2_captions_url: string;
    duration: number;
    title: string;
    viral_score: number;
    hook_type: string;
  }>;
  total_clips: number;
  pipeline_time: number;
}

interface UserQuota {
  user_id: string;
  daily_requests: number;
  last_reset: string;
  concurrent_jobs: number;
}

// =============================================
// MAIN PIPELINE ORCHESTRATOR
// =============================================

export const orchestrateClipPipeline = inngest.createFunction(
  { 
    id: "orchestrate-clip-pipeline",
    retries: 2,
    concurrency: { limit: 2 }, // Reduced to stay within plan limits
  },
  { event: "pipeline/start" },
  async ({ event, step }) => {
    const { youtube_url, user_id, font_family = "anton" } = event.data;
    
    console.log(`🚀 PIPELINE START: User ${user_id}`);
    
    // Step 1: Check user quota and system capacity
    const quotaCheck = await step.run("check-quota", async () => {
      return await checkUserQuota(user_id);
    });
    
    if (!quotaCheck.allowed) {
      throw new NonRetriableError(`Quota exceeded: ${quotaCheck.reason}`);
    }
    
         // Step 2: Trigger Modal pipeline
     const modalResult = await step.run("modal-processing", async () => {
       const response = await fetch(env.MODAL_ENDPOINT, {
         method: "POST",
         headers: {
           "Content-Type": "application/json",
           "Authorization": `Bearer ${env.CLIPPER_SECRET_KEY}`,
         },
        body: JSON.stringify({
          youtube_url,
          user_id,
          font_family,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Modal pipeline failed: ${response.statusText}`);
      }
      
      return await response.json();
    });
    
    if (modalResult.status !== "pipeline_complete") {
      throw new Error(`Modal pipeline failed: ${modalResult.error || "Unknown error"}`);
    }
    
    // Step 3: Process clips for Remotion
    const clips = modalResult.worker_results.flatMap((result: any) => 
      result.clips?.filter((clip: any) => clip.status === "ready_for_remotion") || []
    );
    
    console.log(`📊 CLIPS READY FOR REMOTION: ${clips.length}`);
    
    // Step 4: Send clips to simple SQS system (single-region)
    await step.sendEvent("clips-ready", {
      name: "remotion.render.queue",
      data: {
        userId: user_id,
        pipelineId: modalResult.run_id,
        clips,
        architecture: "simple-sqs-pipeline",
      },
    });
    
    // Step 5: Update user quota (disabled - function not implemented)
    // await step.run("update-quota", async () => {
    //   await updateUserQuota(user_id);
    // });
    
    return {
      status: "pipeline_complete",
      run_id: modalResult.run_id,
      clips_ready: clips.length,
      next_phase: "remotion_rendering",
    };
  }
);

// =============================================
// REMOTION QUEUE MANAGER - DISABLED (now using SQS multi-region)
// =============================================

// DISABLED: This function has been replaced by the SQS multi-region system
// All clips now go through remotion.batch.process event to the SQS queues
/*
export const processClipsWithRemotion = inngest.createFunction(
  {
    id: "process-clips-remotion",
    retries: 3,
    concurrency: { limit: 2 }, // Reduced to stay within plan limits (was 10)
  },
  { event: "remotion/process-clips" },
  async ({ event, step }) => {
    const { run_id, user_id, clips, total_clips } = event.data as ClipProcessingEvent;
    
    console.log(`🎬 REMOTION PROCESSING: ${run_id} - ${clips.length} clips`);
    
    // Step 1: Initialize tracking
    await step.run("init-tracking", async () => {
      await initializeRenderTracking(run_id, user_id, total_clips);
    });
    
    // Step 2: Process clips in batches to respect concurrency
    const batchSize = 10; // Process 10 clips concurrently
    const batches = [];
    
    for (let i = 0; i < clips.length; i += batchSize) {
      batches.push(clips.slice(i, i + batchSize));
    }
    
         // Step 3: Process each batch
     for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
       const batch = batches[batchIndex];
       
       if (!batch) continue;
       
       console.log(`📦 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} clips)`);
       
       // Process batch with concurrency control
       await step.run(`process-batch-${batchIndex}`, async () => {
        const batchPromises = batch.map(async (clip, index) => {
          try {
            // Add staggered delay to prevent rate limiting
            const delay = index * 2000; // 2 second delays
            await new Promise(resolve => setTimeout(resolve, delay));
            
            return await processClipWithRemotion(clip, run_id, user_id);
          } catch (error) {
            console.error(`❌ Clip ${clip.clip_index} failed:`, error);
            return {
              clip_index: clip.clip_index,
              status: "failed",
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        
        // Update tracking for this batch
        await updateRenderProgress(run_id, batchResults);
        
        return batchResults;
      });
      
      // Wait between batches to prevent overwhelming Remotion
      if (batchIndex < batches.length - 1) {
        await step.sleep("batch-delay", "15s");
      }
    }
    
    // Step 4: Wait for all renders to complete and finalize
    const finalResults = await step.run("wait-for-completion", async () => {
      return await waitForAllRendersComplete(run_id);
    });
    
    // Step 5: Notify user
    await step.run("notify-completion", async () => {
      await notifyUserCompletion(user_id, run_id, finalResults);
    });
    
    console.log(`✅ REMOTION COMPLETE: ${run_id} - ${finalResults.successful}/${finalResults.total} clips`);
    
    return {
      status: "remotion_complete",
      run_id,
      successful_clips: finalResults.successful,
      total_clips: finalResults.total,
      failed_clips: finalResults.failed,
    };
  }
);
*/

// =============================================
// SYSTEM MONITORING AND MAINTENANCE
// =============================================

export const systemHealthCheck = inngest.createFunction(
  { id: "system-health-check" },
  { cron: "*/5 * * * *" }, // Every 5 minutes
  async ({ step }) => {
    console.log("🔍 SYSTEM HEALTH CHECK");
    
         // Check Modal capacity
     const modalHealth = await step.run("check-modal", async () => {
       try {
         const response = await fetch(`${process.env.MODAL_ENDPOINT}/system_status`, {
           headers: {
             "Authorization": `Bearer ${process.env.CLIPPER_SECRET_KEY}`,
           },
         });
        
        return response.ok ? "healthy" : "degraded";
      } catch {
        return "unhealthy";
      }
    });
    
    // Check Remotion capacity
    const remotionHealth = await step.run("check-remotion", async () => {
      // Check current Remotion renders
      const activeRenders = await getActiveRemotion();
      return activeRenders.count < 10 ? "healthy" : "at_capacity";
    });
    
    // Check daily quota usage
    const quotaStatus = await step.run("check-quotas", async () => {
      const dailyUsage = await getDailyQuotaUsage();
      return {
        total_requests: dailyUsage.total,
        capacity_used: (dailyUsage.total / 1000) * 100,
        status: dailyUsage.total < 950 ? "healthy" : "near_capacity",
      };
    });
    
    console.log("📊 HEALTH STATUS:", {
      modal: modalHealth,
      remotion: remotionHealth,
      quota: quotaStatus,
    });
    
    return {
      modal: modalHealth,
      remotion: remotionHealth,
      quota: quotaStatus,
      timestamp: new Date().toISOString(),
    };
  }
);

export const dailyQuotaReset = inngest.createFunction(
  { id: "daily-quota-reset" },
  { cron: "0 0 * * *" }, // Every day at midnight
  async ({ step }) => {
    console.log("🔄 DAILY QUOTA RESET");
    
    await step.run("reset-quotas", async () => {
      await resetAllUserQuotas();
    });
    
    return { status: "quotas_reset", timestamp: new Date().toISOString() };
  }
);

// =============================================
// HELPER FUNCTIONS
// =============================================

async function checkUserQuota(user_id: string): Promise<{ allowed: boolean; reason?: string }> {
  // Check daily quota (1000 requests total, ~10-20 per user)
  const userQuota = await getUserQuota(user_id);
  
  if (userQuota.daily_requests >= 20) {
    return { allowed: false, reason: "Daily quota exceeded (20 requests/day)" };
  }
  
  if (userQuota.concurrent_jobs >= 3) {
    return { allowed: false, reason: "Too many concurrent jobs (max 3)" };
  }
  
  // Check system capacity
  const systemLoad = await getSystemLoad();
  if (systemLoad.concurrent_pipelines >= 8) {
    return { allowed: false, reason: "System at capacity, please try again in a few minutes" };
  }
  
  return { allowed: true };
}

/*
async function processClipWithRemotion(
  clip: any, 
  run_id: string, 
  user_id: string
): Promise<any> {
  // Use Remotion API route approach with tiktok-processor-v3 site
  // Generate R2 public URLs for input files
  const r2PublicAccountId = "92b2f2f4576c47a6929f9f0b752833bc";
  const videoPublicUrl = `https://pub-${r2PublicAccountId}.r2.dev/ai-clipper-videos/${clip.s3_video_url}`;
  const captionsPublicUrl = `https://pub-${r2PublicAccountId}.r2.dev/ai-clipper-videos/${clip.s3_captions_url}`;

  // Calculate optimal frames per lambda with concurrency limit consideration
  const duration = clip.duration;
  const frameCalc = calculateOptimalFramesPerLambda(duration, 30, 10); // 10 = max concurrency
  const framesPerLambda = frameCalc.framesPerLambda;
  
  console.log(`🧮 Frame calculation for clip ${clip.clip_index}:`, {
    duration: duration,
    framesPerLambda: frameCalc.framesPerLambda,
    estimatedLambdas: frameCalc.estimatedLambdaCount,
    concurrencyRespected: frameCalc.concurrencyRespected,
    reasoning: frameCalc.reasoning
  });

  const outputKey = `users-data/${user_id}/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}/run-${run_id}/result-remotion/clip-${clip.clip_index.toString().padStart(2, '0')}-${Date.now()}.mp4`;

  try {
    console.log(`🚀 Starting Remotion render with tiktok-processor-v3 site`);
    
    // Call the Remotion API route to handle rendering
    const renderResponse = await fetch("http://localhost:3001/api/remotion-render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoUrl: videoPublicUrl,
        subtitleUrl: captionsPublicUrl,
        duration,
        outputKey,
        framesPerLambda,
        fontFamily: "anton"
      })
    });

    if (!renderResponse.ok) {
      throw new Error(`Remotion API failed: ${renderResponse.status} ${renderResponse.statusText}`);
    }

    const result = await renderResponse.json();
    
    if (!result.success) {
      throw new Error(`Remotion render failed: ${result.error}`);
    }

    const renderId = result.renderId;

    if (!renderId) {
      throw new Error("No render ID returned from Remotion");
    }
    
    return {
      clip_index: clip.clip_index,
      render_id: renderId,
      status: "rendering",
      submitted_at: new Date().toISOString(),
      output_bucket: "ai-clipper-videos",
      output_key: outputKey,
    };
  } catch (error) {
    console.error("Remotion API invocation failed:", error);
    throw new Error(`Remotion API failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function getUserQuota(user_id: string): Promise<UserQuota> {
  // TODO: Implement with your database
  return {
    user_id,
    daily_requests: 0,
    last_reset: new Date().toISOString(),
    concurrent_jobs: 0,
  };
}

async function updateUserQuota(user_id: string): Promise<void> {
  // TODO: Increment user's daily quota
  console.log(`📊 QUOTA UPDATE: User ${user_id} +1 request`);
}

async function getSystemLoad(): Promise<{ concurrent_pipelines: number }> {
  // TODO: Implement system load tracking
  return { concurrent_pipelines: 0 };
}

async function initializeRenderTracking(run_id: string, user_id: string, total_clips: number): Promise<void> {
  // TODO: Initialize render tracking in database
  console.log(`📊 TRACKING INIT: ${run_id} - ${total_clips} clips for user ${user_id}`);
}

async function updateRenderProgress(run_id: string, batchResults: any[]): Promise<void> {
  // TODO: Update render progress in database
  console.log(`📊 PROGRESS UPDATE: ${run_id} - Batch complete`);
}

async function waitForAllRendersComplete(run_id: string): Promise<{ successful: number; total: number; failed: number }> {
  // TODO: Implement render completion tracking
  return { successful: 10, total: 15, failed: 5 };
}

async function notifyUserCompletion(user_id: string, run_id: string, results: any): Promise<void> {
  // TODO: Send user notification (email, websocket, etc.)
  console.log(`🔔 USER NOTIFICATION: ${user_id} - Job ${run_id} complete`);
}

async function getActiveRemotion(): Promise<{ count: number }> {
  // TODO: Check active Remotion renders
  return { count: 0 };
}

async function getDailyQuotaUsage(): Promise<{ total: number }> {
  // TODO: Get total daily usage across all users
  return { total: 0 };
}

async function resetAllUserQuotas(): Promise<void> {
  // TODO: Reset all user daily quotas
  console.log("🔄 ALL USER QUOTAS RESET");
} 
*/