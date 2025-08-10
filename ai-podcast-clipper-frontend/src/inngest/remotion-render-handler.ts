import { inngest } from "./client";
import { createSupabaseAdmin } from "~/lib/supabase-server";

/**
 * Handle when a render is started and trigger monitoring
 * This function listens for render start events and begins progress monitoring
 */
export const handleRenderStarted = inngest.createFunction(
  {
    id: "handle-render-started",
    name: "Handle Render Started",
    retries: 0,
    concurrency: { limit: 25 } // Upgraded to Pro plan - full concurrency
  },
  { event: "remotion.render.started" },
  async ({ event, step, logger }) => {
    const { 
      renderId, 
      clipId, 
      pipelineId, 
      outputKey,
      bucketName,
      functionName
    } = event.data;

    logger.info("🎬 Render started, triggering monitoring", {
      renderId,
      clipId,
      pipelineId,
      outputKey
    });

    // Update clip status to RENDERING
    await step.run("update-clip-status", async () => {
      const supabase = createSupabaseAdmin();
      
      const { error } = await supabase
        .from("generated_clips")
        .update({
          status: "RENDERING",
          updated_at: new Date().toISOString()
        })
        .eq("id", clipId);

      if (error) {
        logger.error("Failed to update clip status to RENDERING", { error: error.message });
        throw new Error(`Failed to update clip status: ${error.message}`);
      }

      logger.info("✅ Clip status updated to RENDERING", { clipId });
    });

    // Create render job record for detailed tracking
    await step.run("create-render-job", async () => {
      const supabase = createSupabaseAdmin();
      
      const { error } = await supabase
        .from("render_jobs")
        .insert({
          render_id: renderId,
          clip_id: clipId,
          pipeline_id: pipelineId,
          remotion_status: "rendering",
          remotion_progress: 0,
          render_started_at: new Date().toISOString()
        });

      if (error) {
        logger.error("Failed to create render job record", { error: error.message });
        // Don't throw here - monitoring can still work without render_jobs record
      } else {
        logger.info("✅ Render job record created", { renderId, clipId });
      }
    });

    // Trigger monitoring function
    await step.sendEvent("start-monitoring", {
      name: "remotion.progress.monitor",
      data: {
        renderId,
        clipId,
        pipelineId,
        outputKey,
        bucketName,
        functionName
      }
    });

    logger.info("✅ Monitoring triggered for render", { renderId, clipId });

    return {
      success: true,
      renderId,
      clipId,
      monitoringTriggered: true
    };
  }
);

/**
 * Handle when Remotion render completes (success or failure)
 * This is called by the monitoring function when renders finish
 */
export const handleRenderCompleted = inngest.createFunction(
  {
    id: "handle-render-completed",
    name: "Handle Render Completed",
    retries: 0,
    concurrency: { limit: 25 } // Upgraded to Pro plan - full concurrency
  },
  { event: "remotion.render.complete" },
  async ({ event, step, logger }) => {
    const { 
      renderId, 
      status, 
      error: renderError, 
      clipId, 
      pipelineId,
      r2_final_url
    } = event.data;

    logger.info("🏁 Render completed", {
      renderId,
      status,
      clipId,
      hasError: !!renderError
    });

    // Update final status
    await step.run("update-final-status", async () => {
      const supabase = createSupabaseAdmin();
      
      if (status === "success") {
        await supabase
          .from("generated_clips")
          .update({
            status: "COMPLETED",
            r2_final_url: r2_final_url,
            updated_at: new Date().toISOString()
          })
          .eq("id", clipId);
          
        logger.info("✅ Clip marked as COMPLETED", { clipId, r2_final_url });
      } else {
        await supabase
          .from("generated_clips")
          .update({
            status: "FAILED",
            error_message: renderError || "Render failed",
            updated_at: new Date().toISOString()
          })
          .eq("id", clipId);
          
        logger.error("❌ Clip marked as FAILED", { clipId, error: renderError });
      }
    });

    // Check if pipeline is complete
    await step.run("check-pipeline-completion", async () => {
      const supabase = createSupabaseAdmin();
      
      const { data: clips } = await supabase
        .from("generated_clips")
        .select("status")
        .eq("pipeline_id", pipelineId);

      if (clips) {
        const totalClips = clips.length;
        const completedClips = clips.filter(c => c.status === "COMPLETED").length;
        const failedClips = clips.filter(c => c.status === "FAILED").length;
        const finishedClips = completedClips + failedClips;

        logger.info("📊 Pipeline progress", {
          pipelineId,
          totalClips,
          completedClips,
          failedClips,
          finishedClips
        });

        if (finishedClips === totalClips) {
          // Pipeline is complete
          await supabase
            .from("pipelines")
            .update({
              status: "completed",
              phase3_completed_at: new Date().toISOString(),
              successful_clips: completedClips,
              failed_clips: failedClips,
              updated_at: new Date().toISOString()
            })
            .eq("id", pipelineId);

          logger.info("🎉 Pipeline completed!", {
            pipelineId,
            successfulClips: completedClips,
            failedClips: failedClips
          });
        }
      }
    });

    return {
      success: true,
      renderId,
      clipId,
      status
    };
  }
); 