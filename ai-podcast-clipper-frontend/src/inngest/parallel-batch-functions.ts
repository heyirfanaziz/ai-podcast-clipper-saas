import { inngest } from "./client";
import { createSupabaseAdmin } from "~/lib/supabase-server";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { NonRetriableError } from "inngest";

// Modal service endpoints for parallel processing
const MODAL_ENDPOINTS = {
  analysis: process.env.PROCESS_YOUTUBE_ENDPOINT || "https://heyirfanaziz--ai-podcast-clipper-analysis-phase-analysis-7b38be.modal.run/",
  batchProcessor: process.env.PROCESS_YOUTUBE_BATCH_ENDPOINT || "https://heyirfanaziz--ai-podcast-clipper-batch-processor-batchpr-66769b.modal.run/"
};

// RapidAPI configuration - YouTube Info & Download API
const RAPIDAPI_CONFIG = {
  baseUrl: "https://youtube-info-download-api.p.rapidapi.com/ajax/download.php",
  apiKey: process.env.RAPIDAPI_KEY || "",
  host: "youtube-info-download-api.p.rapidapi.com",
  maxRetries: 3,
  retryDelay: 10
};

// Batch processing configuration
const BATCH_CONFIG = {
  clipsPerBatch: 4, // Increased to 4 for fire-and-forget processing (no timeout issues)
  maxConcurrentBatches: 2
};

interface Clip {
  id: string;
  title: string;
  video_url: string;
  captions_url: string;
  start_time: number;
  end_time: number;
  duration: number;
  s3_video_url?: string;
  s3_captions_url?: string;
}

const getPresignedUrl = async (
  s3Client: any, // Changed from S3Client to any as S3Client is removed
  bucket: string,
  key: string
) => {
  try {
    const command = new (await import("@aws-sdk/client-s3")).GetObjectCommand({
    Bucket: bucket,
    Key: key,
    });
    
    return await s3Client.getSignedUrl(command, { expiresIn: 3600 });
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    throw error;
  }
};

const getActualVideoDuration = async (videoUrl: string, fallbackDuration: number): Promise<number> => {
  try {
    // For now, return fallback duration
    // In production, you might want to implement actual video duration detection
      return fallbackDuration;
  } catch (error) {
    console.warn("Could not get actual video duration, using fallback:", error);
    return fallbackDuration;
  }
};

function createClient() {
  return createSupabaseAdmin();
}

interface ClipMetadata {
  s3_key: string;
  captions_key: string;
  clip_index: number;
  title: string;
  viral_score: string;
  hook_type: string;
  question_context: string;
  answer_summary: string;
  ending_quality: string;
  duration_reason: string;
  duration: number;
  estimated_lambda_count: number;
  frames_per_lambda: number;
  clip_filename: string;
  captions_count: number;
}

interface AnalysisResult {
  status: "success" | "error";
  run_id: string;
  user_id: string;
  uploaded_file_id: string;
  youtube_url: string;
  video_s3_key: string;
  r2_base_path?: string; // Added for R2 structure compatibility
  transcript: {
    segments: any[];
    language: string;
    transcription_time: number;
  };
  viral_moments: any[];
  performance: {
    download_time: number;
    transcription_time: number;
    ai_analysis_time: number;
    total_time: number;
    estimated_cost: number;
  };
  architecture: string;
  error?: string;
  error_phase?: string;
  early_termination?: boolean;
}

interface BatchProcessingResult {
  status: "success" | "error";
  batch_index: number;
  run_id: string;
  user_id: string;
  uploaded_file_id: string;
  processed_clips: ClipMetadata[];
  failed_clips: any[];
  clips_processed: number;
  clips_failed: number;
  performance: {
    total_time: number;
    estimated_cost: number;
    clips_per_second: number;
  };
  architecture: string;
  error?: string;
  batch_id?: string;
}

interface RapidAPIResponse {
  downloadUrl?: string;
  download_url?: string;
  url?: string;
  link?: string;
  progress_url?: string;
  progressUrl?: string;
  status?: string;
  mess?: string;
  title?: string;
  video_title?: string;
  length?: string;
  duration?: string;
  [key: string]: any; // Allow additional properties
}

/**
 * UNIFIED PIPELINE: Single Function Multi-Step Architecture
 * Handles the ENTIRE pipeline from YouTube submission to R2 upload
 * NEW: Receives download URL from separate polling function
 * Designed for high throughput: 1000 users/hour
 */
export const unifiedPipelineProcessor = inngest.createFunction(
  {
    id: "unified-pipeline-processor",
    name: "Unified Pipeline Processor (Complete Pipeline)",
    retries: 1,  // Allow 1 retry but with proper error handling
    concurrency: { limit: 2 } // Further reduced to prevent multiple containers
  },
  { event: "youtube.video.process.with.download" }, // NEW: Event with download URL
  async ({ event, step, logger }: { event: any; step: any; logger: any }) => {
    const { youtubeUrl, userId, fontFamily, uploadedFileId, downloadUrl, videoId, title, length } = event.data;
    
    logger.info("🚀 UNIFIED PIPELINE: Starting Complete Processing with Download URL", {
      userId,
      youtubeUrl,
      downloadUrl,
      videoId,
      pipelineId: uploadedFileId,
      architecture: "unified-complete-pipeline"
    });

    // STEP 1: Handle YouTube Video Process Event
    const pipelineData = await step.run("handle-youtube-video-process", async () => {
      logger.info("📥 STEP 1: Processing YouTube Video Submission", {
        youtubeUrl,
        userId,
        fontFamily: fontFamily || "anton",
        pipelineId: uploadedFileId
      });

      // Validate input data
      if (!youtubeUrl || !userId || !uploadedFileId) {
        throw new Error("Missing required data: youtubeUrl, userId, or uploadedFileId");
      }

      // Check user credits before proceeding
      const supabase = createClient();
      const { data: userProfile, error: userError } = await supabase
        .from('user_profiles')
        .select('credits, is_blocked')
        .eq('id', userId)
        .single();

      if (userError || !userProfile) {
        throw new Error(`User not found: ${userError?.message || "Unknown error"}`);
      }

      if (userProfile.is_blocked) {
        throw new Error("Account is blocked");
      }

      if (userProfile.credits <= 0) {
        // Update pipeline status to no credits
        await supabase
          .from('pipelines')
          .update({ status: 'no credits', updated_at: new Date().toISOString() })
          .eq('id', uploadedFileId);
        
        throw new Error("User has no credits remaining");
      }

      logger.info("✅ User validation passed", {
        credits: userProfile.credits,
        isBlocked: userProfile.is_blocked
      });

      return {
        youtubeUrl,
        userId,
        fontFamily: fontFamily || "anton",
        pipelineId: uploadedFileId,
        userCredits: userProfile.credits
      };
    });

    // STEP 2: Update Pipeline Status
    await step.run("update-pipeline-status", async () => {
      const supabase = createClient();
      
      const { error } = await supabase
        .from("pipelines")
        .update({
          status: "processing",
          phase1_started_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", pipelineData.pipelineId);

      if (error) {
        logger.error("Failed to update pipeline", { error: error.message || error });
        throw new Error(`Failed to update pipeline: ${error.message || JSON.stringify(error)}`);
      }

      logger.info("✅ Pipeline status updated", { pipelineId: pipelineData.pipelineId });
    });

    // STEP 3: Phase 1 - Analysis (with download URL)
    const analysisResult = await step.run("phase1-analysis", async () => {
      logger.info("🔍 STEP 3: Starting Analysis (with download URL)", {
        downloadUrl: downloadUrl,
        videoId: videoId
      });
      
      const analysisPayload = {
        download_url: downloadUrl, // Use download URL instead of YouTube URL
        uploaded_file_id: pipelineData.pipelineId,
        user_id: pipelineData.userId,
        video_id: videoId,
        title: title
      };

      const authToken = process.env.CLIPPER_SECRET_KEY || process.env.AUTH_TOKEN;
      logger.info("🔑 Authentication Debug", {
        hasClipperSecret: !!process.env.CLIPPER_SECRET_KEY,
        hasAuthToken: !!process.env.AUTH_TOKEN,
        authTokenLength: authToken?.length || 0,
        authTokenPrefix: authToken?.substring(0, 8) || "none",
        endpoint: MODAL_ENDPOINTS.analysis
      });

      // Validate required environment variables
      if (!authToken) {
        logger.error("❌ Missing authentication token");
        throw new Error("Missing CLIPPER_SECRET_KEY or AUTH_TOKEN environment variable");
      }

      // Reduce timeout to prevent FUNCTION_INVOCATION_TIMEOUT
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6 * 60 * 1000); // Reduced to 6 minutes (from 8)

      try {
      const response = await fetch(MODAL_ENDPOINTS.analysis, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
            "Authorization": `Bearer ${authToken}`
        },
          body: JSON.stringify(analysisPayload),
          signal: controller.signal
      });

        clearTimeout(timeoutId);

      if (!response.ok) {
          const errorText = await response.text();
          logger.error("❌ Modal analysis failed", {
            status: response.status,
            statusText: response.statusText,
            error: errorText,
            endpoint: MODAL_ENDPOINTS.analysis,
            authTokenPrefix: authToken?.substring(0, 8) || "none"
          });
          
          // Don't retry on authentication errors
          if (response.status === 401 || response.status === 403) {
            throw new NonRetriableError(`Authentication failed: ${response.status} ${response.statusText} - ${errorText}`);
          }
          
          // Don't retry on client errors (400-499)
          if (response.status >= 400 && response.status < 500) {
            throw new NonRetriableError(`Client error: ${response.status} ${response.statusText} - ${errorText}`);
          }
          
          throw new Error(`Analysis phase failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json() as AnalysisResult;
      
        // Stop pipeline immediately on analysis failure
      if (result.status === "error") {
        logger.error("❌ ANALYSIS FAILED - STOPPING PIPELINE", {
          error: result.error,
          errorPhase: result.error_phase,
          totalTime: result.performance?.total_time || 0,
            cost: result.performance?.estimated_cost || 0
        });

          // Update pipeline status to failed
        const supabase = createClient();
        await supabase
          .from("pipelines")
          .update({
            status: "failed",
            error_message: result.error,
            error_phase: result.error_phase || "analysis",
            total_pipeline_time: result.performance?.total_time || 0,
            estimated_cost: result.performance?.estimated_cost || 0,
            updated_at: new Date().toISOString()
          })
            .eq("id", pipelineData.pipelineId);

          throw new Error(`Analysis phase failed: ${result.error}. Pipeline stopped.`);
      }

        logger.info("✅ STEP 4 Analysis completed successfully", {
          pipelineId: pipelineData.pipelineId,
        viralMoments: result.viral_moments.length,
          totalTime: result.performance?.total_time || 0,
          cost: result.performance?.estimated_cost || 0,
          runId: result.run_id,
          nextStep: "Phase 2 - Batch Processing"
      });

      return result;
      } catch (error) {
        clearTimeout(timeoutId);
        
        if (error instanceof Error && error.name === 'AbortError') {
          logger.error("❌ Modal analysis timed out after 8 minutes");
          
          // Update pipeline status to timeout
          const supabase = createClient();
          await supabase
            .from("pipelines")
            .update({
              status: "timeout",
              error_message: "Modal analysis timed out after 8 minutes",
              error_phase: "analysis",
              updated_at: new Date().toISOString()
            })
            .eq("id", pipelineData.pipelineId);
            
          throw new NonRetriableError("Modal analysis timed out after 8 minutes");
        }
        
        logger.error("❌ Modal analysis failed with error", { 
          error: error instanceof Error ? error.message : String(error),
          pipelineId: pipelineData.pipelineId,
          endpoint: MODAL_ENDPOINTS.analysis
        });
        throw error;
      }
    });

    // STEP 4: Update Pipeline After Analysis
    await step.run("update-pipeline-after-analysis", async () => {
      const supabase = createClient();
      
      const { error } = await supabase
        .from("pipelines")
        .update({
          status: "analysis_completed",
          total_clips: analysisResult.viral_moments.length,
          phase1_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", pipelineData.pipelineId);

      if (error) {
        logger.error("Failed to update pipeline after analysis", { error: error.message || error });
        throw new Error(`Failed to update pipeline after analysis: ${error.message || JSON.stringify(error)}`);
      }

      logger.info("✅ Pipeline updated after analysis", { 
        pipelineId: pipelineData.pipelineId,
        viralMomentsCount: analysisResult.viral_moments.length
      });
    });

    // STEP 5: Phase 2 - Batch Processing
    const batchResults = await step.run("phase2-batch-processing", async () => {
      logger.info("🎬 STEP 5: Starting Batch Processing", {
        viralMomentsCount: analysisResult.viral_moments.length,
        runId: analysisResult.run_id
      });

      // Update pipeline status for Phase 2
      const supabase = createClient();
      await supabase
        .from("pipelines")
        .update({
          status: "batch_processing",
          phase2_started_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", pipelineData.pipelineId);

      // Create batches
      const viralMoments = analysisResult.viral_moments;
      const batchGroups = [];
      
      // Add original index to each viral moment
      const indexedMoments = viralMoments.map((moment: any, index: number) => ({
        ...moment,
        original_index: index
      }));

      // Group into batches of 2
      for (let i = 0; i < indexedMoments.length; i += BATCH_CONFIG.clipsPerBatch) {
        const batch = indexedMoments.slice(i, i + BATCH_CONFIG.clipsPerBatch);
        batchGroups.push({
          batch_index: Math.floor(i / BATCH_CONFIG.clipsPerBatch),
          viral_moments: batch,
          clip_count: batch.length
        });
      }

      logger.info("📊 Batches created", {
        totalClips: viralMoments.length,
        batchCount: batchGroups.length,
        clipsPerBatch: BATCH_CONFIG.clipsPerBatch
      });

      // Process batches in parallel
      const batchPromises = batchGroups.map(async (batch: any, index: number) => {
        const batchPayload = {
          run_id: analysisResult.run_id,
          user_id: pipelineData.userId,
          uploaded_file_id: pipelineData.pipelineId,
          r2_base_path: analysisResult.r2_base_path || `${analysisResult.run_id}`,
          viral_moments: batch.viral_moments,
          batch_index: batch.batch_index,
          video_s3_key: analysisResult.video_s3_key,
          transcript_segments: analysisResult.transcript.segments,
          s3_key_prefix: `${analysisResult.run_id}/clips`
        };

        // Simple direct batch processing with 20-minute timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20 * 60 * 1000); // 20 minutes timeout

        try {
          const response = await fetch(MODAL_ENDPOINTS.batchProcessor, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${process.env.CLIPPER_SECRET_KEY || process.env.AUTH_TOKEN}`
            },
            body: JSON.stringify(batchPayload),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(`Batch ${batch.batch_index} failed: ${response.status} ${response.statusText}`);
          }

          const result = await response.json() as BatchProcessingResult;
          
          if (result.status === "error") {
            throw new Error(`Batch ${batch.batch_index} failed: ${result.error}`);
          }

          logger.info(`✅ Batch ${batch.batch_index} completed`, {
            clipsProcessed: result.clips_processed,
            clipsFailed: result.clips_failed,
            totalTime: result.performance?.total_time || 0
          });

          return result;
        } catch (error) {
          logger.error(`❌ Batch ${batch.batch_index} failed`, { error });
          throw error;
        }
      });

      // Execute batches with controlled concurrency
      const results = [];
      for (let i = 0; i < batchPromises.length; i += BATCH_CONFIG.maxConcurrentBatches) {
        const batch = batchPromises.slice(i, i + BATCH_CONFIG.maxConcurrentBatches);
        const batchResults = await Promise.all(batch);
        results.push(...batchResults);
      }

      logger.info("✅ STEP 6 Batch processing completed", {
        totalBatches: results.length,
        totalClipsProcessed: results.reduce((sum: number, r: any) => sum + r.clips_processed, 0)
      });

      return results;
    });

    // STEP 6: Update Pipeline After Batch Processing
    await step.run("update-pipeline-after-batches", async () => {
      const totalClipsProcessed = batchResults.reduce((sum: number, r: BatchProcessingResult) => sum + r.clips_processed, 0);
      const totalClipsFailed = batchResults.reduce((sum: number, r: BatchProcessingResult) => sum + r.clips_failed, 0);
      
      const supabase = createClient();
      
      const { error } = await supabase
        .from("pipelines")
        .update({
          status: "batch_processing_completed",
          phase2_completed_at: new Date().toISOString(),
          successful_clips: totalClipsProcessed,
          failed_clips: totalClipsFailed,
          updated_at: new Date().toISOString()
        })
        .eq("id", pipelineData.pipelineId);

      if (error) {
        logger.error("Failed to update pipeline after batch processing", { error: error.message || error });
        throw new Error(`Failed to update pipeline after batch processing: ${error.message || JSON.stringify(error)}`);
      }

      logger.info("✅ Pipeline updated after batch processing", { 
        pipelineId: pipelineData.pipelineId,
        totalClipsProcessed,
        totalClipsFailed
      });
    });

    // STEP 7: Phase 3 - Remotion Rendering & R2 Upload
    await step.run("phase3-remotion-rendering", async () => {
      logger.info("🎥 STEP 7: Starting Remotion Rendering & R2 Upload");
      
      // Update pipeline status for Phase 3
      const supabase = createClient();
      await supabase
        .from("pipelines")
        .update({
          status: "remotion_rendering",
          phase3_started_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", pipelineData.pipelineId);

      // Collect all processed clips from batch results
      const allProcessedClips = batchResults.flatMap((result: BatchProcessingResult) => result.processed_clips || []);
      
      logger.info("📊 Collected processed clips", {
        totalBatches: batchResults.length,
        totalProcessedClips: allProcessedClips.length,
        clipsPerBatch: batchResults.map((r: BatchProcessingResult) => r.processed_clips?.length || 0)
      });
      
      if (allProcessedClips.length > 0) {
        // Update pipeline status to rendering queued
        await supabase
          .from("pipelines")
          .update({
            status: "remotion_rendering_queued",
            updated_at: new Date().toISOString()
          })
          .eq("id", pipelineData.pipelineId);

        // Send clips directly to SQS for Remotion rendering
        logger.info("🚀 Sending clips to SQS for Remotion rendering", {
          clipsCount: allProcessedClips.length,
          userId: pipelineData.userId,
          pipelineId: pipelineData.pipelineId
        });

        // Create SQS client
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

        // Create generated_clips records and send to SQS for rendering
        const sqsPromises = allProcessedClips.map(async (clip: any, index: number) => {
          try {
            logger.info(`🎬 Processing clip ${index + 1}/${allProcessedClips.length}`, {
              title: clip.title,
              duration: clip.duration,
              s3_key: clip.s3_key,
              captions_key: clip.captions_key
            });
            // First, create a record in generated_clips table for tracking
            const { data: clipRecord, error: clipError } = await supabase
              .from("generated_clips")
              .insert({
        clip_index: clip.clip_index,
                run_id: analysisResult.run_id,
                pipeline_id: pipelineData.pipelineId,
                user_id: pipelineData.userId,
                title: clip.title,
                start_time: 0, // Will be calculated from clip metadata
                end_time: clip.duration, // Use duration from Modal
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
              throw new Error(`Failed to create clip record: ${clipError?.message}`);
            }

            const clipId = clipRecord.id;

            // Create complete Remotion render configuration for SQS
            const videoS3Key = clip.s3_key || `${analysisResult.run_id}/temp/full-video.mp4`;
            const captionsS3Key = clip.captions_key || `${analysisResult.run_id}/temp/captions-${index}.vtt`;
            
            // Generate output path
            const basePath = videoS3Key.substring(0, videoS3Key.lastIndexOf('/'));
            const outputKey = `${basePath.replace('/result-raw', '/result-remotion')}/${clipId}.mp4`;
            
            const sqsMessage = {
              // Remotion configuration
              functionName: "remotion-render-4-0-320-mem3008mb-disk2048mb-600sec",
              serveUrl: "https://remotionlambda-useast1-m9vorb5nmi.s3.us-east-1.amazonaws.com/sites/tiktok-processor-v2/index.html",
              composition: "CaptionedVideo",
              inputProps: {
                videoUrl: `https://pub-92b2f2f4576c47a6929f9f0b752833bc.r2.dev/${videoS3Key}`,
                subtitleUrl: `https://pub-92b2f2f4576c47a6929f9f0b752833bc.r2.dev/${captionsS3Key}`,
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
                key: outputKey,
                s3OutputProvider: {
                  endpoint: "https://cd3dd24bd9991cd4300824929326a9de.r2.cloudflarestorage.com",
                  accessKeyId: "4eef624649b02ed372635bbe9bf5fc62",
                  secretAccessKey: "1da2dd2d0eac552a148fd3d67cfb003507eff69b4bdc9c700378aa6652c2514b",
                  region: "auto"
                }
              },
              webhook: {
                url: "https://auclip.com/api/remotion-render-started",
                customData: {
                  clipId: clipId,
                  pipelineId: pipelineData.pipelineId,
                  outputKey: outputKey
                }
              },
              clipId: clipId,
              batchId: `batch-${pipelineData.pipelineId}`,
              architecture: "unified-complete-pipeline"
            };

            const command = new SendMessageCommand({
              QueueUrl: process.env.REMOTION_SQS_QUEUE_URL,
              MessageBody: JSON.stringify(sqsMessage),
            });

            await sqsClient.send(command);
            
            logger.info(`📤 Clip ${index + 1}/${allProcessedClips.length} created and sent to SQS`, {
              clipId: clipId,
              title: clip.title,
              duration: `${clip.start_time}s - ${clip.end_time}s`,
              outputKey: outputKey,
              webhookUrl: "https://auclip.com/api/remotion-render-started"
            });

            return { clipId, sqsMessage };
          } catch (error) {
            logger.error(`❌ Failed to process clip ${index + 1}`, {
              error: error instanceof Error ? error.message : String(error),
              clip: clip.title
            });
            throw error;
          }
        });

        // Add timeout for SQS operations to prevent FUNCTION_INVOCATION_TIMEOUT
        const sqsTimeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("SQS operations timed out after 90 seconds")), 90 * 1000)
        );
        
        logger.info("⏱️ Starting SQS operations with 90-second timeout");
        
        await Promise.race([
          Promise.all(sqsPromises),
          sqsTimeout
        ]);
        
        logger.info("✅ All SQS operations completed successfully");
        
        logger.info("✅ All clips sent to SQS for Remotion rendering", {
          renderJobsQueued: allProcessedClips.length
        });
      } else {
        logger.warn("⚠️ No clips to render - skipping Phase 3");
      }
    });

    // STEP 8: Deduct Credits (Fixed URL)
    await step.run("deduct-credits", async () => {
      const totalClipsProcessed = batchResults.reduce((sum: number, r: BatchProcessingResult) => sum + r.clips_processed, 0);
      const creditsToDeduct = totalClipsProcessed;
      
      logger.info("💰 Deducting credits", {
        userId: pipelineData.userId,
        creditsToDeduct,
        originalCredits: pipelineData.userCredits
      });
      
      // Fix: Use proper BASE_URL instead of undefined
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "https://auclip.com";
      const creditUrl = `${baseUrl}/api/deduct-credits`;
      
      logger.info("🔗 Credit deduction URL", { creditUrl });
      
      // Use reliable credit deduction API
      const creditResponse = await fetch(creditUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: pipelineData.userId,
          credits: creditsToDeduct,
          reason: `Processed ${totalClipsProcessed} clips from YouTube video`
        })
      });

      if (!creditResponse.ok) {
        const errorText = await creditResponse.text();
        logger.error('❌ Credit deduction failed:', {
          status: creditResponse.status,
          statusText: creditResponse.statusText,
          error: errorText,
          url: creditUrl
        });
        throw new Error(`Failed to deduct credits: ${errorText}`);
      }
      
      const creditResult = await creditResponse.json();
      logger.info('✅ Credits deducted:', creditResult);
    });

    // STEP 9: Final Pipeline Update
    await step.run("final-pipeline-update", async () => {
      const totalClipsProcessed = batchResults.reduce((sum: number, r: BatchProcessingResult) => sum + r.clips_processed, 0);
      const totalClipsFailed = batchResults.reduce((sum: number, r: BatchProcessingResult) => sum + r.clips_failed, 0);
      
      const supabase = createClient();
      
      const { error } = await supabase
        .from("pipelines")
        .update({
          status: "completed",
          phase3_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
        })
        .eq("id", pipelineData.pipelineId);

      if (error) {
        logger.error("Failed to update pipeline as completed", { error: error.message || error });
        throw new Error(`Failed to update pipeline as completed: ${error.message || JSON.stringify(error)}`);
      }

      logger.info("✅ UNIFIED PIPELINE COMPLETED", {
        pipelineId: pipelineData.pipelineId,
        totalClipsProcessed,
        totalClipsFailed,
        architecture: "unified-complete-pipeline"
      });
    });

    return {
      success: true,
      pipelineId: pipelineData.pipelineId,
      runId: analysisResult.run_id,
      viralMomentsCount: analysisResult.viral_moments.length,
      totalClipsProcessed: batchResults.reduce((sum: number, r: BatchProcessingResult) => sum + r.clips_processed, 0),
      totalClipsFailed: batchResults.reduce((sum: number, r: BatchProcessingResult) => sum + r.clips_failed, 0),
      totalTime: analysisResult.performance.total_time,
      cost: analysisResult.performance.estimated_cost,
      architecture: "unified-complete-pipeline"
    };
  }
);

/**
 * RAPIDAPI POLLING FUNCTION - Separate from main pipeline
 * Can run for up to 10 minutes to wait for download URL
 * Once ready, triggers the main unified pipeline
 */
export const rapidApiPollingProcessor = inngest.createFunction(
  {
    id: "rapidapi-polling-processor",
    name: "RapidAPI Polling Processor (10-minute timeout)",
    retries: 0, // No retries - if polling fails, user can retry manually
    concurrency: { limit: 25 } // Upgraded to Pro plan - full concurrency
  },
  { event: "youtube.video.process" },
  async ({ event, step, logger }: { event: any; step: any; logger: any }) => {
    const { youtubeUrl, userId, fontFamily, uploadedFileId } = event.data;
    
    logger.info("🔄 RAPIDAPI POLLING: Starting 10-minute polling session", {
      userId,
      youtubeUrl,
      pipelineId: uploadedFileId
    });

    // STEP 1: Initial RapidAPI Request
    const rapidApiResult = await step.run("rapidapi-initial-request", async () => {
      logger.info("🔗 STEP 1: Initial RapidAPI Request", {
        youtubeUrl,
        pipelineId: uploadedFileId
      });

      if (!RAPIDAPI_CONFIG.apiKey) {
        throw new Error("Missing RAPIDAPI_KEY environment variable");
      }

      // Extract video ID from YouTube URL
      let videoId = null;
      if (youtubeUrl.includes('youtube.com/watch?v=')) {
        videoId = youtubeUrl.split('v=')[1].split('&')[0];
      } else if (youtubeUrl.includes('youtu.be/')) {
        videoId = youtubeUrl.split('youtu.be/')[1].split('?')[0];
      } else {
        throw new Error("Invalid YouTube URL format");
      }

      logger.info("🎯 Extracted video ID", { videoId });

      // Build endpoint with your specific parameters
      const params = new URLSearchParams({
        format: "1080",
        add_info: "0",
        url: youtubeUrl,
        audio_quality: "128",
        allow_extended_duration: "true",
        no_merge: "false",
        audio_language: "en"
      });

      const endpoint = `?${params.toString()}`;

      logger.info("🔑 Using API key", { 
        apiKeyPrefix: RAPIDAPI_CONFIG.apiKey.substring(0, 8),
        apiKeySuffix: RAPIDAPI_CONFIG.apiKey.substring(RAPIDAPI_CONFIG.apiKey.length - 8),
        endpoint: endpoint
      });

      // Retry logic for initial request
      let success = false;
      let result = null;

      for (let attempt = 0; attempt < RAPIDAPI_CONFIG.maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            logger.info(`🔄 Retry attempt ${attempt + 1}/${RAPIDAPI_CONFIG.maxRetries}`);
            await new Promise(resolve => setTimeout(resolve, RAPIDAPI_CONFIG.retryDelay * 1000));
          }

          const response = await fetch(`${RAPIDAPI_CONFIG.baseUrl}${endpoint}`, {
            method: 'GET',
            headers: {
              'X-RapidAPI-Key': RAPIDAPI_CONFIG.apiKey,
              'X-RapidAPI-Host': RAPIDAPI_CONFIG.host
            }
          });

          logger.info("📡 API Response Status", { 
            status: response.status,
            attempt: attempt + 1
          });

          if (response.ok) {
            result = await response.json() as RapidAPIResponse;
            success = true;
            break;
          } else {
            const errorText = await response.text();
            logger.warn(`⚠️ API request failed with status ${response.status}`, {
              error: errorText,
              attempt: attempt + 1
            });
          }

        } catch (error) {
          logger.warn(`⚠️ Request attempt ${attempt + 1} failed`, {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      if (!success || !result) {
        throw new Error("All API request attempts failed");
      }

      // Check response for different possible formats
      logger.info("📡 RapidAPI Response Analysis", { 
        resultKeys: Object.keys(result),
        hasDownloadUrl: !!(result.downloadUrl || result.download_url || result.url || result.link),
        hasProgressUrl: !!(result.progress_url || result.progressUrl),
        hasStatus: !!result.status,
        hasMessage: !!result.mess,
        fullResponse: result
      });

      // Check if we got a direct download URL
      const downloadUrl = result.downloadUrl || result.download_url || result.url || result.link;
      
      if (downloadUrl) {
        logger.info("✅ Direct download URL received", {
          downloadUrl: downloadUrl,
          videoId: videoId,
          endpoint: endpoint
      });

      return {
          downloadUrl: downloadUrl,
          videoId: videoId,
          title: result.title || result.video_title || `Video ${videoId}`,
          length: result.length || result.duration || "Unknown"
        };
      }

      // Check if we got a progress URL (polling required)
      const progressUrl = result.progress_url || result.progressUrl;
      
      if (!progressUrl) {
        logger.error("❌ No download URL or progress URL in response", { 
          result,
          videoId: videoId,
          endpoint: endpoint
        });
        throw new Error("No download URL returned from RapidAPI");
      }

      logger.info("⏳ Progress URL received - starting 10-minute polling", {
        progressUrl: progressUrl,
        videoId: videoId,
        status: result.status,
        message: result.mess,
        endpoint: endpoint
      });

      return {
        progressUrl: progressUrl,
        videoId: videoId,
        title: result.title || result.video_title || `Video ${videoId}`,
        length: result.length || result.duration || "Unknown"
      };
    });

    // STEP 2: Monitor Progress URL to Get Download URL
    const downloadResult = await step.run("rapidapi-10min-polling", async () => {
      logger.info("⏳ STEP 2: Starting 10-minute polling session", {
        progressUrl: rapidApiResult.progressUrl,
        videoId: rapidApiResult.videoId
      });

      // Poll the progress URL every 5 seconds for up to 10 minutes
      const maxPollAttempts = 120; // 10 minutes max (120 * 5 seconds)
      const pollInterval = 5000; // 5 seconds
      
      for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
        logger.info(`🔄 Polling attempt ${attempt}/${maxPollAttempts}`, {
          progressUrl: rapidApiResult.progressUrl,
          attempt: attempt
        });

        try {
          const pollResponse = await fetch(rapidApiResult.progressUrl);
          
          if (!pollResponse.ok) {
            logger.warn(`⚠️ Poll request failed with status ${pollResponse.status}`, {
              attempt: attempt,
              status: pollResponse.status
            });
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            continue;
          }

          const pollResult = await pollResponse.json();
          
          logger.info(`📊 Poll response ${attempt}`, {
            success: pollResult.success,
            progress: pollResult.progress,
            text: pollResult.text,
            hasDownloadUrl: !!pollResult.download_url,
            downloadUrl: pollResult.download_url,
            attempt: attempt
          });

          // Check if download URL is ready
          if (pollResult.download_url) {
            logger.info("✅ Download URL ready! Exiting polling loop", {
              downloadUrl: pollResult.download_url,
              progress: pollResult.progress,
              text: pollResult.text,
              attempts: attempt
            });

            const result = {
              downloadUrl: pollResult.download_url,
              videoId: rapidApiResult.videoId,
              title: rapidApiResult.title,
              length: rapidApiResult.length
            };

            logger.info("🚀 Polling step completed successfully", { result });
            return result;
          }

          // Check if still processing
          if (pollResult.progress < 1000) {
            logger.info(`⏳ Still processing: ${pollResult.progress}/1000`, {
              progress: pollResult.progress,
              text: pollResult.text,
              attempt: attempt
            });
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            continue;
          }

          // Progress is 1000 but no download URL - this shouldn't happen
          logger.warn("⚠️ Progress complete but no download URL", {
            progress: pollResult.progress,
            text: pollResult.text,
            attempt: attempt
          });
          await new Promise(resolve => setTimeout(resolve, pollInterval));

        } catch (error) {
          logger.warn(`⚠️ Poll attempt ${attempt} failed`, {
            error: error instanceof Error ? error.message : String(error),
            attempt: attempt
          });
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
      }

      // If we get here, polling timed out
      logger.error("❌ Polling timed out", { maxPollAttempts, progressUrl: rapidApiResult.progressUrl });
      throw new Error(`Polling timed out after ${maxPollAttempts} attempts (10 minutes). Progress URL: ${rapidApiResult.progressUrl}`);
    });

    logger.info("✅ Polling step completed, proceeding to Phase 1 trigger", { downloadResult });

    // STEP 3: Trigger Phase 1 with Download URL
    const eventResult = await step.run("trigger-phase1", async () => {
      logger.info("🚀 STEP 3: Triggering Phase 1 Analysis", {
        downloadUrl: downloadResult.downloadUrl,
        videoId: downloadResult.videoId
      });

      try {
        const eventData = {
          youtubeUrl,
          userId,
          fontFamily,
          uploadedFileId,
          downloadUrl: downloadResult.downloadUrl,
          videoId: downloadResult.videoId,
          title: downloadResult.title,
          length: downloadResult.length
        };

        logger.info("📤 Sending phase1.analysis.start event", { eventData });

        const result = await inngest.send({
          name: "phase1.analysis.start",
          data: eventData
        });

        logger.info("✅ Phase 1 triggered successfully", { result });
        return result;
      } catch (error) {
        logger.error("❌ Failed to trigger Phase 1", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
        throw error;
      }
    });

    logger.info("✅ RAPIDAPI POLLING: Completed successfully");
  }
);

/**
 * PHASE 1 ANALYSIS PROCESSOR - Separate 10-minute function
 * Handles Modal analysis with download URL
 */
export const phase1AnalysisProcessor = inngest.createFunction(
  {
    id: "phase1-analysis-processor",
    name: "Phase 1 Analysis Processor (10-minute timeout)",
    retries: 1,
    concurrency: { limit: 2 }
  },
  { event: "phase1.analysis.start" },
  async ({ event, step, logger }: { event: any; step: any; logger: any }) => {
    const { youtubeUrl, userId, fontFamily, uploadedFileId, downloadUrl, videoId, title, length } = event.data;
    
    logger.info("🔍 PHASE 1: Starting Analysis with Download URL", {
      userId,
      youtubeUrl,
      downloadUrl,
      videoId,
      pipelineId: uploadedFileId
    });

    // STEP 1: User Validation
    const pipelineData = await step.run("user-validation", async () => {
      logger.info("📥 STEP 1: User Validation", {
        youtubeUrl,
        userId,
        fontFamily: fontFamily || "anton",
        pipelineId: uploadedFileId
      });

      // Validate input data
      if (!youtubeUrl || !userId || !uploadedFileId || !downloadUrl) {
        throw new Error("Missing required data: youtubeUrl, userId, uploadedFileId, or downloadUrl");
      }

      // Check user credits before proceeding
      const supabase = createClient();
      const { data: userProfile, error: userError } = await supabase
        .from('user_profiles')
        .select('credits, is_blocked')
        .eq('id', userId)
        .single();

      if (userError || !userProfile) {
        throw new Error(`User not found: ${userError?.message || "Unknown error"}`);
      }

      if (userProfile.is_blocked) {
        throw new Error("Account is blocked");
      }

      if (userProfile.credits <= 0) {
        // Update pipeline status to no credits
      await supabase
          .from('pipelines')
          .update({ status: 'no credits', updated_at: new Date().toISOString() })
          .eq('id', uploadedFileId);
        
        throw new Error("User has no credits remaining");
      }

      logger.info("✅ User validation passed", {
        credits: userProfile.credits,
        isBlocked: userProfile.is_blocked
      });

      return {
        youtubeUrl,
        userId,
        fontFamily: fontFamily || "anton",
        pipelineId: uploadedFileId,
        userCredits: userProfile.credits
      };
    });

    // STEP 2: Update Pipeline Status
    await step.run("update-pipeline-status", async () => {
      const supabase = createClient();
      
      const { error } = await supabase
        .from("pipelines")
        .update({
          status: "processing",
          phase1_started_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", pipelineData.pipelineId);

      if (error) {
        logger.error("Failed to update pipeline", { error: error.message || error });
        throw new Error(`Failed to update pipeline: ${error.message || JSON.stringify(error)}`);
      }

      logger.info("✅ Pipeline status updated", { pipelineId: pipelineData.pipelineId });
    });

    // STEP 3: Modal Analysis
    const analysisResult = await step.run("modal-analysis", async () => {
      logger.info("🔍 STEP 3: Modal Analysis", {
        downloadUrl: downloadUrl,
        videoId: videoId
      });
      
      const analysisPayload = {
        download_url: downloadUrl,
        uploaded_file_id: pipelineData.pipelineId,
        user_id: pipelineData.userId,
        video_id: videoId,
        title: title
      };

      const authToken = process.env.CLIPPER_SECRET_KEY || process.env.AUTH_TOKEN;
      logger.info("🔑 Authentication Debug", {
        hasClipperSecret: !!process.env.CLIPPER_SECRET_KEY,
        hasAuthToken: !!process.env.AUTH_TOKEN,
        authTokenLength: authToken?.length || 0,
        authTokenPrefix: authToken?.substring(0, 8) || "none",
        endpoint: MODAL_ENDPOINTS.analysis
      });

      // Validate required environment variables
      if (!authToken) {
        logger.error("❌ Missing authentication token");
        throw new Error("Missing CLIPPER_SECRET_KEY or AUTH_TOKEN environment variable");
      }

      // 8-minute timeout for Modal analysis
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8 * 60 * 1000);

      try {
        const response = await fetch(MODAL_ENDPOINTS.analysis, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${authToken}`
          },
          body: JSON.stringify(analysisPayload),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          logger.error("❌ Modal analysis failed", {
            status: response.status,
            statusText: response.statusText,
            error: errorText,
            endpoint: MODAL_ENDPOINTS.analysis,
            authTokenPrefix: authToken?.substring(0, 8) || "none"
          });
          
          // Don't retry on authentication errors
          if (response.status === 401 || response.status === 403) {
            throw new NonRetriableError(`Authentication failed: ${response.status} ${response.statusText} - ${errorText}`);
          }
          
          // Don't retry on client errors (400-499)
          if (response.status >= 400 && response.status < 500) {
            throw new NonRetriableError(`Client error: ${response.status} ${response.statusText} - ${errorText}`);
          }
          
          throw new Error(`Analysis phase failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const result = await response.json() as AnalysisResult;
        
        // Stop pipeline immediately on analysis failure
        if (result.status === "error") {
          logger.error("❌ ANALYSIS FAILED - STOPPING PIPELINE", {
            error: result.error,
            errorPhase: result.error_phase,
            totalTime: result.performance?.total_time || 0,
            cost: result.performance?.estimated_cost || 0
          });

          // Update pipeline status to failed
          const supabase = createClient();
          await supabase
            .from("pipelines")
            .update({
              status: "failed",
              error_message: result.error,
              error_phase: result.error_phase || "analysis",
              total_pipeline_time: result.performance?.total_time || 0,
              estimated_cost: result.performance?.estimated_cost || 0,
              updated_at: new Date().toISOString()
            })
            .eq("id", pipelineData.pipelineId);

          throw new Error(`Analysis phase failed: ${result.error}. Pipeline stopped.`);
        }

        logger.info("✅ Modal analysis completed successfully", {
          pipelineId: pipelineData.pipelineId,
          viralMomentsCount: result.viral_moments.length,
          analysisTime: result.performance.total_time,
          cost: result.performance.estimated_cost
        });

        return result;
      } catch (error) {
        clearTimeout(timeoutId);
        
        if (error instanceof Error && error.name === 'AbortError') {
          logger.error("❌ Modal analysis timed out after 8 minutes");
          throw new Error("Modal analysis timed out after 8 minutes");
        }
        
        throw error;
      }
    });

    // STEP 4: Update Pipeline After Analysis
    await step.run("update-pipeline-after-analysis", async () => {
      const supabase = createClient();
      
      const { error } = await supabase
        .from("pipelines")
        .update({
          status: "analysis_completed",
          total_clips: analysisResult.viral_moments.length,
          phase1_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", pipelineData.pipelineId);

      if (error) {
        logger.error("Failed to update pipeline after analysis", { error: error.message || error });
        throw new Error(`Failed to update pipeline after analysis: ${error.message || JSON.stringify(error)}`);
      }

      logger.info("✅ Pipeline updated after analysis", { 
        pipelineId: pipelineData.pipelineId,
        viralMomentsCount: analysisResult.viral_moments.length
      });
    });

    // STEP 5: Trigger Phase 2
    await step.run("trigger-phase2", async () => {
      logger.info("🚀 STEP 5: Triggering Phase 2 Batch Processing", {
        viralMomentsCount: analysisResult.viral_moments.length,
        runId: analysisResult.run_id
      });

      try {
        const eventData = {
          youtubeUrl,
            userId,
          fontFamily,
            uploadedFileId,
          analysisResult: analysisResult
        };

        logger.info("📤 Sending phase2.batch.start event", { eventData });

        const result = await inngest.send({
          name: "phase2.batch.start",
          data: eventData
        });

        logger.info("✅ Phase 2 triggered successfully", { result });
        return result;
      } catch (error) {
        logger.error("❌ Failed to trigger Phase 2", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
        throw error;
      }
    });

    logger.info("✅ PHASE 1: Completed successfully");
  }
);

/**
 * PHASE 2 BATCH PROCESSOR - Separate 10-minute function
 * Handles Modal batch processing of viral moments
 */
export const phase2BatchProcessor = inngest.createFunction(
  {
    id: "phase2-batch-processor",
    name: "Phase 2 Batch Processor (20-minute timeout)",
    retries: 1,
    concurrency: { limit: 25 }
  },
  { event: "phase2.batch.start" },
  async ({ event, step, logger }: { event: any; step: any; logger: any }) => {
    const { youtubeUrl, userId, fontFamily, uploadedFileId, analysisResult } = event.data;
    
    logger.info("🎬 PHASE 2: Starting Batch Processing", {
      userId,
      youtubeUrl,
      viralMomentsCount: analysisResult.viral_moments.length,
      runId: analysisResult.run_id,
      pipelineId: uploadedFileId
    });

    // STEP 1: Update Pipeline Status for Phase 2
    await step.run("update-pipeline-phase2", async () => {
      const supabase = createClient();
      await supabase
        .from("pipelines")
        .update({
          status: "batch_processing",
          phase2_started_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", uploadedFileId);

      logger.info("✅ Pipeline status updated for Phase 2", { pipelineId: uploadedFileId });
    });

    // STEP 2: Create Batches
    const batchGroups = await step.run("create-batches", async () => {
      const viralMoments = analysisResult.viral_moments;
      const groups = [];
      
      // Add original index to each viral moment
      const indexedMoments = viralMoments.map((moment: any, index: number) => ({
        ...moment,
        original_index: index
      }));

      // Group into batches of 4
      for (let i = 0; i < indexedMoments.length; i += BATCH_CONFIG.clipsPerBatch) {
        const batch = indexedMoments.slice(i, i + BATCH_CONFIG.clipsPerBatch);
        groups.push({
          batch_index: Math.floor(i / BATCH_CONFIG.clipsPerBatch),
          viral_moments: batch,
          clip_count: batch.length
        });
      }

      logger.info("📊 Batches created", {
        totalClips: viralMoments.length,
        batchCount: groups.length,
        clipsPerBatch: BATCH_CONFIG.clipsPerBatch
      });

      return groups;
    });

    // STEP 3: Process Batches
    const batchResults = await step.run("process-batches", async () => {
      // Process batches in parallel
      const batchPromises = batchGroups.map(async (batch: any, index: number) => {
        const batchPayload = {
          run_id: analysisResult.run_id,
          user_id: userId,
          uploaded_file_id: uploadedFileId,
          r2_base_path: analysisResult.r2_base_path || `${analysisResult.run_id}`,
          viral_moments: batch.viral_moments,
          batch_index: batch.batch_index,
          video_s3_key: analysisResult.video_s3_key,
          transcript_segments: analysisResult.transcript.segments,
          s3_key_prefix: `${analysisResult.run_id}/clips`
        };

        // Simple direct batch processing with 20-minute timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20 * 60 * 1000); // 20 minutes timeout

        try {
          const response = await fetch(MODAL_ENDPOINTS.batchProcessor, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${process.env.CLIPPER_SECRET_KEY || process.env.AUTH_TOKEN}`
            },
            body: JSON.stringify(batchPayload),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(`Batch ${batch.batch_index} failed: ${response.status} ${response.statusText}`);
          }

          const result = await response.json() as BatchProcessingResult;
          
          if (result.status === "error") {
            throw new Error(`Batch ${batch.batch_index} failed: ${result.error}`);
          }

          logger.info(`✅ Batch ${batch.batch_index} completed`, {
            clipsProcessed: result.clips_processed,
            clipsFailed: result.clips_failed,
            totalTime: result.performance?.total_time || 0
          });

          return result;
        } catch (error) {
          clearTimeout(timeoutId);
          
          if (error instanceof Error && error.name === 'AbortError') {
            logger.error(`❌ Batch ${batch.batch_index} timed out after 20 minutes`);
            throw new Error(`Batch ${batch.batch_index} timed out after 20 minutes`);
          }
          
          logger.error(`❌ Batch ${batch.batch_index} failed`, { error });
          throw error;
        }
      });

      // Execute batches with controlled concurrency
      const results = [];
      for (let i = 0; i < batchPromises.length; i += BATCH_CONFIG.maxConcurrentBatches) {
        const batch = batchPromises.slice(i, i + BATCH_CONFIG.maxConcurrentBatches);
        const batchResults = await Promise.all(batch);
        results.push(...batchResults);
      }

      logger.info("✅ All batches processed successfully", {
        totalBatches: results.length,
        totalClipsProcessed: results.reduce((sum: number, r: any) => sum + r.clips_processed, 0)
      });

      return results;
    });

    // STEP 4: Update Pipeline After Batch Processing
    await step.run("update-pipeline-after-batches", async () => {
      const totalClipsProcessed = batchResults.reduce((sum: number, r: BatchProcessingResult) => sum + r.clips_processed, 0);
      const totalClipsFailed = batchResults.reduce((sum: number, r: BatchProcessingResult) => sum + r.clips_failed, 0);

      const supabase = createClient();
      await supabase
        .from("pipelines")
        .update({
          status: "batch_completed",
          successful_clips: totalClipsProcessed,
          failed_clips: totalClipsFailed,
          batch_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", uploadedFileId);

      logger.info("✅ Pipeline updated after batch processing", {
        pipelineId: uploadedFileId,
        successfulClips: totalClipsProcessed,
        failedClips: totalClipsFailed
      });
    });

    // STEP 5: Trigger Phase 3
    await step.run("trigger-phase3", async () => {
      logger.info("🚀 STEP 5: Triggering Phase 3 Remotion Rendering", {
        totalClipsProcessed: batchResults.reduce((sum: number, r: BatchProcessingResult) => sum + r.clips_processed, 0)
      });

      try {
        const eventData = {
          youtubeUrl,
          userId,
          fontFamily,
          uploadedFileId,
          analysisResult: analysisResult,
          batchResults: batchResults
        };

        logger.info("📤 Sending phase3.remotion.start event", { eventData });

        const result = await inngest.send({
          name: "phase3.remotion.start",
          data: eventData
        });

        logger.info("✅ Phase 3 triggered successfully", { result });
        return result;
      } catch (error) {
        logger.error("❌ Failed to trigger Phase 3", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
        throw error;
      }
    });

    logger.info("✅ PHASE 2: Completed successfully");
  }
);

/**
 * PHASE 3 REMOTION PROCESSOR - Fire and forget SQS method
 * Handles Remotion rendering queue and credit deduction
 */
export const phase3RemotionProcessor = inngest.createFunction(
  {
    id: "phase3-remotion-processor",
    name: "Phase 3 Remotion Processor (Fire and Forget)",
    retries: 0, // No retries - fire and forget
    concurrency: { limit: 25 }
  },
  { event: "phase3.remotion.start" },
  async ({ event, step, logger }: { event: any; step: any; logger: any }) => {
    const { youtubeUrl, userId, fontFamily, uploadedFileId, analysisResult, batchResults } = event.data;
    
    logger.info("🎥 PHASE 3: Starting Remotion Rendering (Fire and Forget)", {
      userId,
      youtubeUrl,
      totalClips: batchResults.reduce((sum: number, r: BatchProcessingResult) => sum + r.clips_processed, 0),
      pipelineId: uploadedFileId
    });

    // STEP 1: SQS Queue Processing
    await step.run("sqs-queue-processing", async () => {
      const allProcessedClips = batchResults.flatMap((result: BatchProcessingResult) => result.processed_clips);
      
      if (allProcessedClips.length === 0) {
        logger.warn("⚠️ No clips to render - skipping SQS processing");
        return;
      }

      // Initialize SQS client
      const sqsClient = new SQSClient({
        region: "us-east-1",
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ""
        }
      });

      logger.info("📤 Starting SQS queue processing", {
        totalClips: allProcessedClips.length,
        queueUrl: process.env.REMOTION_SQS_QUEUE_URL
      });

      const sqsPromises = allProcessedClips.map(async (clip: any, index: number) => {
        try {
          const clipId = `clip-${analysisResult.run_id}-${clip.clip_index}`;
          const outputKey = `result-raw/${analysisResult.run_id}/clips/${clip.clip_filename}`;
          
          const sqsMessage = {
            // Remotion configuration
            functionName: "remotion-render-handler",
            serveUrl: "https://auclip.com",
            composition: "CaptionedVideo",
            inputProps: {
              videoUrl: clip.s3_key,
              captionsUrl: clip.captions_key,
              title: clip.title,
              fontFamily: fontFamily || "anton"
            },
            codec: "h264",
            privacy: "public",
            outName: clip.clip_filename,
            webhook: "https://auclip.com/api/remotion-render-started"
          };

          const command = new SendMessageCommand({
            QueueUrl: process.env.REMOTION_SQS_QUEUE_URL,
            MessageBody: JSON.stringify(sqsMessage),
          });

          await sqsClient.send(command);
          
          logger.info(`📤 Clip ${index + 1}/${allProcessedClips.length} sent to SQS`, {
            clipId: clipId,
            title: clip.title,
            outputKey: outputKey
          });

          return { clipId, sqsMessage };
        } catch (error) {
          logger.error(`❌ Failed to send clip ${index + 1} to SQS`, {
            error: error instanceof Error ? error.message : String(error),
            clip: clip.title
          });
          throw error;
        }
      });

      // 90-second timeout for SQS operations
      const sqsTimeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("SQS operations timed out after 90 seconds")), 90 * 1000)
      );
      
      logger.info("⏱️ Starting SQS operations with 90-second timeout");
      
      await Promise.race([
        Promise.all(sqsPromises),
        sqsTimeout
      ]);
      
      logger.info("✅ All SQS operations completed successfully");
    });

    // STEP 2: Deduct Credits
    await step.run("deduct-credits", async () => {
      const totalClipsProcessed = batchResults.reduce((sum: number, r: BatchProcessingResult) => sum + r.clips_processed, 0);
      
      if (totalClipsProcessed === 0) {
        logger.warn("⚠️ No clips processed - skipping credit deduction");
        return;
      }

      const creditsToDeduct = totalClipsProcessed;
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "https://auclip.com";
      
      logger.info("💳 Deducting credits", {
        userId: userId,
        creditsToDeduct: creditsToDeduct,
        baseUrl: baseUrl
      });

      try {
        const response = await fetch(`${baseUrl}/api/deduct-credits`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId: userId,
            credits: creditsToDeduct,
            pipelineId: uploadedFileId
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error("❌ Credit deduction failed", {
            status: response.status,
            error: errorText
          });
          throw new Error(`Credit deduction failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const result = await response.json();
        logger.info("✅ Credits deducted successfully", {
          userId: userId,
          creditsDeducted: creditsToDeduct,
          remainingCredits: result.remainingCredits
        });
      } catch (error) {
        logger.error("❌ Credit deduction failed", {
          error: error instanceof Error ? error.message : String(error)
        });
        // Don't throw error - this is fire and forget
      }
    });

    // STEP 3: Final Pipeline Update
    await step.run("final-pipeline-update", async () => {
      const totalClipsProcessed = batchResults.reduce((sum: number, r: BatchProcessingResult) => sum + r.clips_processed, 0);
      const totalClipsFailed = batchResults.reduce((sum: number, r: BatchProcessingResult) => sum + r.clips_failed, 0);

      const supabase = createClient();
      await supabase
        .from("pipelines")
          .update({ 
          status: "completed",
          successful_clips: totalClipsProcessed,
          failed_clips: totalClipsFailed,
          completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
        .eq("id", uploadedFileId);

      logger.info("✅ Pipeline marked as completed", {
        pipelineId: uploadedFileId,
        successfulClips: totalClipsProcessed,
        failedClips: totalClipsFailed
      });
    });

    logger.info("✅ PHASE 3: Completed successfully (Fire and Forget)");
  }
);

export const rapidApiOrchestrator = inngest.createFunction(
  {
    id: "rapidapi-orchestrator",
    name: "RapidAPI Download Orchestrator (10-minute timeout)",
    retries: 0,
    concurrency: { limit: 25 }
  },
  { event: "youtube.video.process" },
  async ({ event, step, logger }) => {
    const { youtubeUrl, userId, uploadedFileId } = event.data;
    
    logger.info("🔗 RAPIDAPI: Starting download orchestration", {
      userId,
      youtubeUrl,
      pipelineId: uploadedFileId
    });

    // Step 1: Send RapidAPI request (5 seconds)
    const apiResponse = await step.run("send-rapidapi-request", async () => {
      // Build query parameters exactly as shown in the RapidAPI documentation
      const params = new URLSearchParams({
        format: "1080",
        add_info: "0",
        url: youtubeUrl,
        audio_quality: "128",
        allow_extended_duration: "true",
        no_merge: "false",
        audio_language: "en"
      });

      const response = await fetch(`https://youtube-info-download-api.p.rapidapi.com/ajax/download.php?${params}`, {
        method: "GET",
        headers: {
          "X-RapidAPI-Key": process.env.RAPIDAPI_KEY || "",
          "X-RapidAPI-Host": "youtube-info-download-api.p.rapidapi.com"
        }
      });

      if (!response.ok) {
        throw new Error(`RapidAPI request failed: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    });

    // Step 2: Poll for download URL (webhook-driven, non-blocking)
    const downloadResult = await step.run("poll-for-download-url", async () => {
      const progressUrl = apiResponse.progress_url;
      const maxAttempts = 120; // 10 minutes max (120 * 5 seconds)
      const pollInterval = 5000; // 5 seconds
      
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        logger.info(`🔄 Polling RapidAPI (${attempt}/${maxAttempts})`);
        
        try {
          const statusResponse = await fetch(progressUrl, {
            method: "GET",
            headers: {
              "X-RapidAPI-Key": process.env.RAPIDAPI_KEY || "",
              "X-RapidAPI-Host": "youtube-info-download-api.p.rapidapi.com"
            }
          });

          if (!statusResponse.ok) {
            logger.warn(`⚠️ Status check failed: ${statusResponse.status}`);
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            continue;
          }

          const status = await statusResponse.json();
          
          if (status.download_url) {
            logger.info(`✅ Download URL available: ${status.download_url.substring(0, 100)}...`);
            return {
              download_url: status.download_url,
              video_id: status.video_id || youtubeUrl,
              title: status.title || "Unknown Title"
            };
          }

          // Wait before next poll
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          
        } catch (error) {
          logger.warn(`⚠️ Poll attempt ${attempt} failed:`, error);
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
      }

      throw new Error(`Download URL not available after ${maxAttempts} polling attempts (10 minutes)`);
    });

    // Step 3: Trigger Phase 1 (5 seconds)
    await step.run("trigger-phase1", async () => {
      await inngest.send({
        name: "phase1.analysis.start",
        data: {
          downloadUrl: downloadResult.download_url,
          videoId: downloadResult.video_id,
          title: downloadResult.title,
          userId,
          uploadedFileId,
          youtubeUrl
        }
      });
    });

    logger.info("✅ RapidAPI orchestration completed");
  }
);

// REMOVED: Old polling-based phase1Orchestrator - replaced with event-driven version