import { inngest } from "./client";
import { createSupabaseAdmin } from "~/lib/supabase-server";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { NonRetriableError } from "inngest";

// Modal service endpoints for parallel processing
const MODAL_ENDPOINTS = {
  analysis: process.env.PROCESS_YOUTUBE_ENDPOINT || "https://heyirfanaziz--ai-podcast-clipper-analysis-phase-analysis-7b38be.modal.run/",
  batchProcessor: process.env.PROCESS_YOUTUBE_BATCH_ENDPOINT || "https://heyirfanaziz--ai-podcast-clipper-batch-processor-batchpr-66769b.modal.run/"
};

// Batch processing configuration
const BATCH_CONFIG = {
  clipsPerBatch: 4,
  maxConcurrentBatches: 2
};

function createClient() {
  return createSupabaseAdmin();
}

/**
 * Phase 1 Orchestrator - Event-Driven Version
 * Triggers Modal Phase 1 and waits for webhook completion
 */
export const phase1OrchestratorEventDriven = inngest.createFunction(
  {
    id: "phase1-orchestrator-event-driven",
    name: "Phase 1 Analysis Orchestrator (Event-Driven)",
    retries: 0,
    concurrency: { limit: 5 }
  },
  { event: "phase1.analysis.start" },
  async ({ event, step, logger }) => {
    const { downloadUrl, videoId, title, userId, uploadedFileId, youtubeUrl } = event.data;
    
    logger.info("🎬 PHASE 1: Starting event-driven analysis orchestration", {
      userId,
      videoId,
      title,
      pipelineId: uploadedFileId
    });

    // Step 1: Update pipeline status
    await step.run("update-pipeline-status", async () => {
      const supabase = createClient();
      await supabase
        .from("pipelines")
        .update({
          status: "phase1_processing",
          phase1_started_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", uploadedFileId);
    });

    // Step 2: Trigger Modal Phase 1 (fire-and-forget)
    const modalTriggerResult = await step.run("trigger-modal-phase1", async () => {
      logger.info("🚀 Triggering Modal Phase 1 analysis");
      
      const response = await fetch(MODAL_ENDPOINTS.analysis, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.CLIPPER_SECRET_KEY || process.env.AUTH_TOKEN}`
        },
        body: JSON.stringify({
          download_url: downloadUrl,
          video_id: videoId,
          title: title,
          user_id: userId,
          uploaded_file_id: uploadedFileId
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("Modal Phase 1 trigger failed", { 
          status: response.status, 
          statusText: response.statusText,
          error: errorText 
        });
        throw new Error(`Modal Phase 1 failed to start: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      logger.info("✅ Modal Phase 1 triggered successfully", { 
        run_id: result.run_id,
        status: result.status 
      });
      
      return {
        run_id: result.run_id || `phase1-${Date.now()}`,
        status: result.status
      };
    });

    // Step 3: Wait for Modal webhook completion (event-driven with timeout)
    logger.info("⏳ Waiting for Modal Phase 1 webhook completion", {
      eventName: "modal.phase1.completed",
      expectedUploadedFileId: uploadedFileId,
      timeout: "20m"
    });
    
    const webhookResult = await step.waitForEvent("wait-for-modal-phase1-webhook", {
      event: "modal.phase1.completed",
      timeout: "20m", // 20 minute timeout
      // Use match to filter by uploaded_file_id for more reliable event filtering
      match: "data.uploaded_file_id"
    });

    if (!webhookResult) {
      logger.error("Phase 1 webhook timeout", { run_id: modalTriggerResult.run_id });
      
      // Update pipeline status to failed
      const supabase = createClient();
      await supabase
        .from("pipelines")
        .update({
          status: "failed",
          error_message: "Phase 1 analysis timed out after 20 minutes",
          updated_at: new Date().toISOString()
        })
        .eq("id", uploadedFileId);
      
      throw new Error("Phase 1 analysis timed out - no webhook received");
    }

    const analysisResult = webhookResult.data.results;
    logger.info("✅ Phase 1 completed via webhook", {
      run_id: webhookResult.data.run_id,
      viral_moments: analysisResult.viral_moments?.length || 0,
      transcript_segments: analysisResult.transcript?.segments?.length || 0
    });

    // Step 4: Update pipeline with Phase 1 results
    await step.run("update-pipeline-phase1-complete", async () => {
      const supabase = createClient();
      await supabase
        .from("pipelines")
        .update({
          status: "phase1_completed",
          phase1_completed_at: new Date().toISOString(),
          viral_moments_count: analysisResult.viral_moments?.length || 0,
          updated_at: new Date().toISOString()
        })
        .eq("id", uploadedFileId);
    });

    // Step 5: Trigger Phase 2 batch processing
    await step.run("trigger-phase2", async () => {
      logger.info("🚀 Triggering Phase 2 batch processing");
      
      await inngest.send({
        name: "phase2.batch.start",
        data: {
          analysisResult,
          userId,
          uploadedFileId,
          youtubeUrl
        }
      });
      
      logger.info("✅ Phase 2 triggered successfully");
    });

    return {
      success: true,
      run_id: modalTriggerResult.run_id,
      viral_moments_count: analysisResult.viral_moments?.length || 0,
      phase: "phase1_completed"
    };
  }
);

/**
 * Phase 2 Batch Processor - Event-Driven Version
 * Processes clips in batches and waits for webhook completion
 */
export const phase2BatchProcessorEventDriven = inngest.createFunction(
  {
    id: "phase2-batch-processor-event-driven",
    name: "Phase 2 Batch Processor (Event-Driven)",
    retries: 0,
    concurrency: { limit: 3 }
  },
  { event: "phase2.batch.start" },
  async ({ event, step, logger }) => {
    const { analysisResult, userId, uploadedFileId, youtubeUrl } = event.data;
    
    logger.info("🎬 PHASE 2: Starting event-driven batch processing", {
      userId,
      pipelineId: uploadedFileId,
      viral_moments: analysisResult.viral_moments?.length || 0
    });

    // Step 1: Update pipeline status
    await step.run("update-pipeline-status-phase2", async () => {
      const supabase = createClient();
      await supabase
        .from("pipelines")
        .update({
          status: "phase2_processing",
          phase2_started_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", uploadedFileId);
    });

    // Step 2: Create batches from viral moments
    const batches = await step.run("create-batches", async () => {
      const viralMoments = analysisResult.viral_moments || [];
      const batches = [];
      
      for (let i = 0; i < viralMoments.length; i += BATCH_CONFIG.clipsPerBatch) {
        const batch = viralMoments.slice(i, i + BATCH_CONFIG.clipsPerBatch);
        // Add original index to each moment for tracking
        const batchWithIndex = batch.map((moment: any, idx: number) => ({
          ...moment,
          original_index: i + idx
        }));
        batches.push(batchWithIndex);
      }
      
      logger.info(`📦 Created ${batches.length} batches from ${viralMoments.length} clips`);
      return batches;
    });

    // Step 3: Trigger all batch processing in parallel
    const batchTriggers = await step.run("trigger-batch-processing", async () => {
      const triggers = [];
      
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        
        logger.info(`🚀 Triggering batch ${batchIndex + 1}/${batches.length} with ${batch.length} clips`);
        
        const response = await fetch(MODAL_ENDPOINTS.batchProcessor, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.CLIPPER_SECRET_KEY || process.env.AUTH_TOKEN}`
          },
          body: JSON.stringify({
            run_id: analysisResult.run_id,
            user_id: userId,
            uploaded_file_id: uploadedFileId,
            r2_base_path: analysisResult.r2_base_path,
            viral_moments: batch,
            batch_index: batchIndex,
            // Legacy fields for backward compatibility
            video_s3_key: analysisResult.uploaded_files?.video,
            transcript_segments: analysisResult.transcript?.segments || [],
            s3_key_prefix: analysisResult.r2_base_path
          })
        });

        if (!response.ok) {
          logger.error(`Batch ${batchIndex} trigger failed`, { 
            status: response.status,
            statusText: response.statusText 
          });
          continue;
        }

        const result = await response.json();
        triggers.push({
          batch_index: batchIndex,
          run_id: result.run_id || `batch-${batchIndex}-${Date.now()}`,
          status: result.status
        });
      }
      
      logger.info(`✅ Triggered ${triggers.length} batch processors`);
      return triggers;
    });

    // Step 4: Wait for all batch webhooks to complete
    const batchResults = await step.run("wait-for-batch-webhooks", async () => {
      const results = [];
      const timeoutMs = 30 * 60 * 1000; // 30 minutes total timeout
      const startTime = Date.now();
      
      for (const trigger of batchTriggers) {
        const remainingTime = Math.max(1, timeoutMs - (Date.now() - startTime));
        
        logger.info(`⏳ Waiting for batch ${trigger.batch_index} webhook (timeout: ${Math.round(remainingTime/1000)}s)`);
        
        // Use step.waitForEvent with a unique step ID for each batch
        const webhookResult = await step.waitForEvent(`wait-batch-${trigger.batch_index}`, {
          event: "modal.phase2.completed",
          timeout: `${Math.round(remainingTime/1000)}s`,
          match: "data.batch_index"
          // Removed if condition as it can cause type issues
        });
        
        if (webhookResult) {
          logger.info(`✅ Batch ${trigger.batch_index} completed via webhook`);
          results.push(webhookResult.data.results);
        } else {
          logger.error(`❌ Batch ${trigger.batch_index} timed out`);
          results.push({
            batch_index: trigger.batch_index,
            status: "timeout",
            processed_clips: [],
            failed_clips: []
          });
        }
      }
      
      return results;
    });

    // Step 5: Aggregate results and update pipeline
    const aggregatedResults = await step.run("aggregate-batch-results", async () => {
      let totalProcessed = 0;
      let totalFailed = 0;
      const allProcessedClips = [];
      const allFailedClips = [];
      
      for (const batchResult of batchResults) {
        if (batchResult.status !== "timeout") {
          totalProcessed += batchResult.clips_processed || 0;
          totalFailed += batchResult.clips_failed || 0;
          allProcessedClips.push(...(batchResult.processed_clips || []));
          allFailedClips.push(...(batchResult.failed_clips || []));
        }
      }
      
      logger.info("📊 Batch processing complete", {
        totalProcessed,
        totalFailed,
        batches: batchResults.length
      });
      
      // Update pipeline status
      const supabase = createClient();
      await supabase
        .from("pipelines")
        .update({
          status: "phase2_completed",
          phase2_completed_at: new Date().toISOString(),
          successful_clips: totalProcessed,
          failed_clips: totalFailed,
          updated_at: new Date().toISOString()
        })
        .eq("id", uploadedFileId);
      
      return {
        totalProcessed,
        totalFailed,
        allProcessedClips,
        allFailedClips
      };
    });

    // Step 6: Trigger Phase 3 (Remotion rendering)
    if (aggregatedResults.allProcessedClips.length > 0) {
      await step.run("trigger-phase3", async () => {
        logger.info("🚀 Triggering Phase 3 Remotion rendering");
        
        await inngest.send({
          name: "phase3.remotion.start",
          data: {
            processedClips: aggregatedResults.allProcessedClips,
            userId,
            uploadedFileId,
            youtubeUrl,
            analysisResult
          }
        });
        
        logger.info("✅ Phase 3 triggered successfully");
      });
    }

    return {
      success: true,
      totalProcessed: aggregatedResults.totalProcessed,
      totalFailed: aggregatedResults.totalFailed,
      phase: "phase2_completed"
    };
  }
);

/**
 * Phase 3 Remotion Processor - Handles SQS queuing and rendering
 */
export const phase3RemotionProcessor = inngest.createFunction(
  {
    id: "phase3-remotion-processor",
    name: "Phase 3 Remotion Processor",
    retries: 0,
    concurrency: { limit: 5 }
  },
  { event: "phase3.remotion.start" },
  async ({ event, step, logger }) => {
    const { processedClips, userId, uploadedFileId, youtubeUrl, analysisResult } = event.data;
    
    logger.info("🎥 PHASE 3: Starting Remotion rendering", {
      userId,
      pipelineId: uploadedFileId,
      clips: processedClips.length
    });

    // Update pipeline status
    await step.run("update-pipeline-status-phase3", async () => {
      const supabase = createClient();
      await supabase
        .from("pipelines")
        .update({
          status: "remotion_rendering",
          phase3_started_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", uploadedFileId);
    });

    // Send clips to SQS for Remotion rendering
    const sqsResults = await step.run("send-to-sqs", async () => {
      if (!process.env.REMOTION_AWS_ACCESS_KEY_ID || !process.env.REMOTION_AWS_SECRET_ACCESS_KEY) {
        throw new Error("Missing AWS credentials for SQS");
      }

      const sqsClient = new SQSClient({
        region: "us-east-1",
        credentials: {
          accessKeyId: process.env.REMOTION_AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.REMOTION_AWS_SECRET_ACCESS_KEY,
        },
      });

      const supabase = createClient();
      const results = [];

      for (const clip of processedClips) {
        try {
          // Create generated_clips record
          const { data: clipRecord, error: clipError } = await supabase
            .from("generated_clips")
            .insert({
              clip_index: clip.clip_index,
              run_id: analysisResult.run_id,
              pipeline_id: uploadedFileId,
              user_id: userId,
              title: clip.title,
              start_time: 0,
              end_time: clip.duration,
              duration: clip.duration,
              viral_score: parseInt(clip.viral_score) || 8,
              hook_type: clip.hook_type || "general",
              question_context: clip.question_context || "",
              answer_summary: clip.answer_summary || "",
              ending_quality: clip.ending_quality || "",
              duration_reason: clip.duration_reason || "",
              status: "QUEUED",
              video_s3_key: clip.s3_key
            })
            .select("id")
            .single();

          if (clipError || !clipRecord) {
            logger.error(`Failed to create clip record`, { error: clipError });
            continue;
          }

          // Send to SQS
          const sqsMessage = {
            functionName: "remotion-render-4-0-320-mem3008mb-disk2048mb-600sec",
            serveUrl: "https://remotionlambda-useast1-m9vorb5nmi.s3.us-east-1.amazonaws.com/sites/tiktok-processor-v2/index.html",
            composition: "CaptionedVideo",
            inputProps: {
              videoUrl: `https://pub-92b2f2f4576c47a6929f9f0b752833bc.r2.dev/${clip.s3_key}`,
              subtitleUrl: `https://pub-92b2f2f4576c47a6929f9f0b752833bc.r2.dev/${clip.captions_key}`,
              durationInSeconds: clip.duration,
              highlightColor: "#39E508",
              backgroundColor: "#FFFFFF",
              captionSpeed: "medium",
              fontSize: 120,
              fontFamily: "anton"
            },
            codec: "h264",
            privacy: "public",
            outName: {
              bucketName: "ai-clipper-videos",
              key: clip.s3_key.replace('/result-raw/', '/result-remotion/').replace('.mp4', `-${clipRecord.id}.mp4`),
              s3OutputProvider: {
                endpoint: "https://cd3dd24bd9991cd4300824929326a9de.r2.cloudflarestorage.com",
                accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
                secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
                region: "auto"
              }
            },
            webhook: {
              url: "https://auclip.com/api/remotion-render-started",
              customData: {
                clipId: clipRecord.id,
                pipelineId: uploadedFileId
              }
            },
            clipId: clipRecord.id,
            batchId: `batch-${uploadedFileId}`
          };

          const command = new SendMessageCommand({
            QueueUrl: process.env.REMOTION_SQS_QUEUE_URL,
            MessageBody: JSON.stringify(sqsMessage),
          });

          await sqsClient.send(command);
          
          logger.info(`✅ Clip ${clip.clip_index} sent to SQS`, { clipId: clipRecord.id });
          results.push({ clipId: clipRecord.id, status: "queued" });
          
        } catch (error) {
          logger.error(`Failed to queue clip ${clip.clip_index}`, { error });
          results.push({ clipIndex: clip.clip_index, status: "failed", error: error instanceof Error ? error.message : String(error) });
        }
      }

      return results;
    });

    // Update pipeline to completed
    await step.run("update-pipeline-completed", async () => {
      const supabase = createClient();
      await supabase
        .from("pipelines")
        .update({
          status: "completed",
          phase3_completed_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", uploadedFileId);
    });

    return {
      success: true,
      clipsQueued: sqsResults.filter(r => r.status === "queued").length,
      clipsFailed: sqsResults.filter(r => r.status === "failed").length,
      phase: "phase3_completed"
    };
  }
);
