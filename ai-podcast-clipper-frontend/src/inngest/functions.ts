import { env } from "~/env";
import { inngest } from "./client";
import { createSupabaseAdmin } from "~/lib/supabase-server";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { calculateOptimalFramesPerLambda } from "./utils/frames-calculator";
// Add SQS imports for single-region integration
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

// Type definitions for production backend responses
interface ProductionBackendResponse {
  status: string;
  run_id: string;
  user_id: string;
  clips_generated: number;
  clips_failed?: number;
  processing_time_seconds: number;
  download_time_seconds?: number;
  video_processing_time_seconds?: number;
  total_estimated_cost_usd?: number;
  architecture: string;
  clip_metadata?: ClipMetadata[];
  s3_key_prefix?: string;
  error?: string;
}

interface ClipMetadata {
  s3_key: string;
  captions_key: string;
  clip_index: number;
  title?: string;
  viral_score?: string;
  hook_type?: string;
  question_context?: string;
  answer_summary?: string;
  ending_quality?: string;
  duration_reason?: string;
  duration: number;
  estimated_lambda_count: number;
  frames_per_lambda: number;
  clip_filename?: string;
}

interface RemotionRenderInfo {
  render_id: string;
  clip_index: number;
  duration: number;
  status: string;
  title?: string;
  viral_score?: number;
}

// Production YouTube video processing with production-safe Modal integration
export const processYouTubeVideo = inngest.createFunction(
  {
    id: "process-youtube-video-production",
    retries: 1, // Minimal retries for production safety
    concurrency: {
      limit: 1, // Reduced to stay within plan limits
    },
  },
  { event: "process-youtube-video" },
  async ({ event, step }) => {
    const { uploadedFileId, youtubeUrl, userId, fontFamily } = event.data as {
      uploadedFileId: string;
      youtubeUrl: string;
      userId: string;
      fontFamily?: string;
    };

    console.log(`🚀 PRODUCTION PIPELINE: Starting for ${uploadedFileId}`);
    console.log(`👤 User: ${userId}`);
    console.log(`📹 URL: ${youtubeUrl}`);
    console.log(`🎯 Architecture: production-safe-single-container`);

    // Use admin client for all database operations
    const supabase = createSupabaseAdmin();

    try {
      const { credits } = await step.run(
        "check-user-credits",
        async () => {
          // Get user credits using admin client
          const { data: userProfile, error: userError } = await supabase
            .from('user_profiles')
            .select('credits')
            .eq('id', userId)
            .single();

          if (userError || !userProfile) {
            throw new Error(`User not found: ${userError?.message}`);
          }

          return {
            userId: userId,
            credits: userProfile.credits as number,
          };
        },
      );

      if (credits <= 0) {
        await step.run("set-status-no-credits", async () => {
          await supabase
            .from('pipelines')
            .update({ status: 'no credits' })
            .eq('id', uploadedFileId);
        });
        console.log(`❌ User ${userId} has no credits remaining`);
        return;
      }

      await step.run("set-status-processing", async () => {
        await supabase
          .from('pipelines')
          .update({ status: 'processing' })
          .eq('id', uploadedFileId);
      });

      console.log(`💳 User has ${credits} credits, proceeding with processing`);

      // Call production-safe Modal endpoint with extended timeout and detailed logging
      const backendResponse = await step.run(
        "call-production-modal-pipeline",
        async () => {
          console.log(`🎯 Calling production-safe Modal endpoint: ${env.MODAL_ENDPOINT}`);
          console.log(`📊 Request payload:`, { 
            youtube_url: youtubeUrl,
            uploaded_file_id: uploadedFileId,
            font_family: fontFamily ?? "anton",
            user_id: userId
          });
          
          // Create abort controller for 10-minute timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => {
            console.log(`⏰ Modal call timed out after 10 minutes`);
            controller.abort();
          }, 10 * 60 * 1000); // 10 minutes

          try {
            console.log(`🚀 Starting Modal fetch call...`);
            const startTime = Date.now();
            
            const response = await fetch(`${env.MODAL_ENDPOINT}`, {
              method: "POST",
              body: JSON.stringify({ 
                youtube_url: youtubeUrl,
                uploaded_file_id: uploadedFileId,
                font_family: fontFamily ?? "anton",
                user_id: userId
              }),
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${env.CLIPPER_SECRET_KEY}`,
              },
              signal: controller.signal,
            });

            clearTimeout(timeoutId);
            const fetchTime = (Date.now() - startTime) / 1000;
            console.log(`⏱️ Modal fetch completed in ${fetchTime.toFixed(1)}s`);

            if (!response.ok) {
              const errorText = await response.text();
              console.error(`❌ Modal endpoint failed: ${response.status} - ${errorText}`);
              throw new Error(`Production Modal failed: ${response.status} - ${errorText}`);
            }

            console.log(`📥 Parsing Modal response...`);
            const responseData = await response.json() as ProductionBackendResponse;
            console.log(`✅ Production Modal response received:`, {
              status: responseData.status,
              clips_generated: responseData.clips_generated,
              processing_time: responseData.processing_time_seconds,
              architecture: responseData.architecture,
              has_clip_metadata: !!responseData.clip_metadata,
              clip_metadata_count: responseData.clip_metadata?.length || 0
            });
            
            return responseData;
          } catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error && error.name === 'AbortError') {
              console.error(`❌ Modal call aborted due to timeout`);
              throw new Error(`Modal call timed out after 10 minutes`);
            }
            console.error(`❌ Modal call failed:`, error);
            throw error;
          }
        },
      );

      // Process successful response and create clips with metadata
      const { clipsCreated, clipMetadata } = await step.run(
        "create-clips-from-production-response",
        async () => {
          if (backendResponse.status !== "success") {
            throw new Error(`Production pipeline failed: ${backendResponse.error ?? "Unknown error"}`);
          }

          const clipsGenerated = backendResponse.clips_generated ?? 0;
          const clipMetadataList = backendResponse.clip_metadata ?? [];
          console.log(`🎬 Production pipeline generated ${clipsGenerated} clips`);
          console.log(`⏱️ Processing time: ${backendResponse.processing_time_seconds?.toFixed(1)}s`);
          console.log(`💰 Estimated cost: $${backendResponse.total_estimated_cost_usd?.toFixed(4) ?? "0.0000"}`);
          console.log(`🏗️ Architecture: ${backendResponse.architecture}`);
          console.log(`📋 Clip metadata: ${clipMetadataList.length} clips with full metadata`);

          if (clipsGenerated > 0 && clipMetadataList.length > 0) {
            // Create clips in database with full viral metadata
            const clipData = clipMetadataList.map((metadata: ClipMetadata) => ({
              s3_key: metadata.s3_key,
              pipeline_id: uploadedFileId,
              user_id: userId,
              clip_index: metadata.clip_index,
              title: metadata.title || `Viral Clip ${(metadata.clip_index || 0) + 1}`,
              viral_score: metadata.viral_score || null,
              hook_type: metadata.hook_type || null,
              question_context: metadata.question_context || null,
              answer_summary: metadata.answer_summary || null,
              ending_quality: metadata.ending_quality || null,
              duration_reason: metadata.duration_reason || null,
              created_at: new Date().toISOString(),
            }));

            const { error: clipError } = await supabase
              .from('generated_clips')
              .insert(clipData);

            if (clipError) {
              console.error(`❌ Failed to create clips:`, clipError);
              throw new Error(`Failed to create clips: ${clipError.message}`);
            }

            console.log(`✅ Created ${clipData.length} clip records with viral metadata`);
            console.log(`🌍 Clips available at R2 CDN: https://pub-92b2f2f4576c47a6929f9f0b752833bc.r2.dev/ai-clipper-videos/`);
            
            return { clipsCreated: clipsGenerated, clipMetadata: clipMetadataList };
          }

          console.log(`⚠️ No clips generated by production pipeline`);
          return { clipsCreated: 0, clipMetadata: [] };
        },
      );

      // Queue Remotion renders for all clips using SQS batch system
      await step.run("queue-remotion-renders", async () => {
        if (clipMetadata.length > 0) {
          console.log(`🎬 Queuing ${clipMetadata.length} clips for SQS multi-region rendering...`);
          
          // Convert clipMetadata to the format expected by the SQS batch system  
          const clips = (clipMetadata as ClipMetadata[]).map((metadata) => ({
            id: `clip_${metadata.clip_index}_${Date.now()}`, // Generate a unique ID
            clip_index: metadata.clip_index,
            title: metadata.title || `Clip ${metadata.clip_index}`,
            duration: metadata.duration,
            s3_video_url: metadata.s3_key,
            s3_captions_url: metadata.captions_key,
            status: "READY_FOR_REMOTION",
            viral_score: metadata.viral_score || "0",
            hook_type: metadata.hook_type || "unknown",
            user_id: userId,
            pipeline_id: uploadedFileId
          }));

          // Send to enhanced SQS system with better file naming
          await inngest.send({
            name: "remotion.render.queue",
            data: {
              userId,
              pipelineId: uploadedFileId,
              clips,
              architecture: "enhanced-sqs-pipeline",
            },
          });

          console.log(`✅ Queued ${clipMetadata.length} clips for SQS multi-region rendering`);
        }
      });

      // Deduct credits based on clips ACTUALLY created (not estimated)
      await step.run("deduct-user-credits", async () => {
        const creditsToDeduct = Number(clipsCreated) || 0;
        
        console.log(`💰 Deducting ${creditsToDeduct} credits from user ${userId}`);
        
        // Use reliable credit deduction API
        const creditResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/deduct-credits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            credits: creditsToDeduct,
            reason: `Processed ${clipsCreated} clips from YouTube video`
          })
        });

        if (!creditResponse.ok) {
          const errorText = await creditResponse.text();
          console.error('❌ Credit deduction failed:', errorText);
          throw new Error(`Failed to deduct credits: ${errorText}`);
        }
        
        const creditResult = await creditResponse.json();
        console.log('✅ Credits deducted:', creditResult);
      });

      // Update final status
      await step.run("set-final-status", async () => {
        const { error } = await supabase
          .from('pipelines')
          .update({ 
            status: 'completed',
            updated_at: new Date().toISOString()
          })
          .eq('id', uploadedFileId);

        if (error) {
          console.error(`❌ Failed to update final status:`, error);
          throw new Error(`Failed to update final status: ${error.message}`);
        }
        
        console.log(`✅ Pipeline ${uploadedFileId} completed successfully`);
      });

      console.log(`🎉 PRODUCTION PIPELINE COMPLETED`);
      console.log(`📊 Results: ${clipsCreated} clips created, ${Math.min(credits, Number(clipsCreated) || 0)} credits deducted`);
      
      return { success: true, clipsCreated: Number(clipsCreated) || 0, creditsDeducted: Math.min(credits, Number(clipsCreated) || 0) };

    } catch (error) {
      console.error(`❌ Production pipeline failed:`, error);
      
      // Update pipeline status to failed
      await step.run("set-status-failed", async () => {
        await supabase
          .from('pipelines')
          .update({ 
            status: 'failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', uploadedFileId);
      });

      throw error;
    }
  },
);

// Monitor system health
export const monitorSystemHealth = inngest.createFunction(
  {
    id: "monitor-system-health",
    retries: 0,
  },
  { cron: "0 */6 * * *" }, // Every 6 hours
  async ({ step }) => {
    console.log(`🔍 Checking production Modal health...`);
    
    const healthCheck = await step.run("check-modal-health", async () => {
      try {
        const response = await fetch(`${env.MODAL_SYSTEM_STATUS_ENDPOINT}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${env.CLIPPER_SECRET_KEY}`,
          },
        });

        if (!response.ok) {
          console.log(`❌ Production Modal health check failed: ${response.status}`);
          return { healthy: false, status: response.status };
        }

        const data = await response.json();
        console.log(`✅ Production Modal healthy:`, data);
        return { healthy: true, data };
      } catch (error) {
        console.error(`❌ Production Modal health check error:`, error);
        return { healthy: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    return healthCheck;
  },
);

// Legacy video processing function (kept for backward compatibility)
export const processVideoEvents = inngest.createFunction(
  {
    id: "ai-podcast-clipper-frontend-process-video-events",
    retries: 3,
    concurrency: {
      limit: 10,
    },
  },
  { event: "process-video-events" },
  async ({ event, step }) => {
    const { uploadedFileId, userId } = event.data as {
      uploadedFileId: string;
      userId: string;
    };

    console.log(`🎥 Processing video for uploadedFileId: ${uploadedFileId}, userId: ${userId}`);

    // Use admin client
    const supabase = createSupabaseAdmin();

    try {
      // This is a legacy function - most logic moved to processYouTubeVideo
      console.log(`ℹ️ Legacy video processing triggered - consider using processYouTubeVideo instead`);
      
      return { success: true, message: "Legacy processing completed" };
    } catch (error) {
      console.error(`❌ Legacy video processing failed:`, error);
      throw error;
    }
  },
);

// Audio processing function (kept for backward compatibility)
export const processAudio = inngest.createFunction(
  {
    id: "ai-podcast-clipper-frontend-process-audio",
    retries: 3,
    concurrency: {
      limit: 1, // Reduced to stay within plan limits
    },
  },
  { event: "audio/process" },
  async ({ event, step }) => {
    console.log(`🎵 Audio processing triggered - this is a legacy function`);
    
    // Use admin client
    const supabase = createSupabaseAdmin();
    
    try {
      // Legacy function - kept for backward compatibility
      console.log(`ℹ️ Legacy audio processing - consider using processYouTubeVideo instead`);
      
      return { success: true, message: "Legacy audio processing completed" };
    } catch (error) {
      console.error(`❌ Legacy audio processing failed:`, error);
      throw error;
    }
  },
);

/**
 * Simple SQS Integration Function 
 * Replaces test-5-clips-dynamic.js for production pipeline
 */
/**
 * Generate clean, descriptive filename for clips
 * Format: "clip-title--viral-score--duration.mp4"
 */
function generateClipFilename(clip: any, index: number): string {
  // Clean title: remove special chars, limit length, make URL-safe
  const cleanTitle = (clip.title || `clip-${index + 1}`)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '') // Remove special chars except spaces
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/--+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
    .substring(0, 50); // Limit to 50 chars

  // Add metadata for easy identification
  const viralScore = `viral-${clip.viral_score || 0}`;
  const duration = `${Math.round(clip.duration || 0)}s`;
  const paddedIndex = String(index + 1).padStart(2, '0');
  
  return `${paddedIndex}-${cleanTitle}--${viralScore}--${duration}.mp4`;
}

export const queueRemotionRenderSimple = inngest.createFunction(
  {
    id: "queue-remotion-render-simple",
    retries: 2,
    concurrency: { limit: 1 },
  },
  { event: "remotion.render.queue" },
  async ({ event, step }) => {
    const { clips, pipelineId, userId } = event.data;

    // Validate input
    if (!clips || !Array.isArray(clips) || clips.length === 0) {
      throw new Error('No clips provided for rendering');
    }

    if (!pipelineId || !userId) {
      throw new Error('Pipeline ID and User ID are required');
    }

    console.log(`🎬 Starting SQS render queue for ${clips.length} clips in pipeline ${pipelineId}`);

    const supabase = createSupabaseAdmin();

    // Update pipeline status to rendering
    await step.run("update-pipeline-status", async () => {
      const { error } = await supabase
        .from('pipelines')
        .update({ 
          status: 'PHASE3_RENDERING',
          phase3_started_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', pipelineId);

      if (error) {
        console.error(`❌ Failed to update pipeline status:`, error);
        throw new Error(`Failed to update pipeline status: ${error.message}`);
      }

      console.log(`✅ Pipeline ${pipelineId} status updated to PHASE3_RENDERING`);
    });

    // Send clips to SQS
    const results = await step.run("send-clips-to-sqs", async () => {
      // Validate AWS credentials before creating client
      if (!env.REMOTION_AWS_ACCESS_KEY_ID || !env.REMOTION_AWS_SECRET_ACCESS_KEY) {
        throw new Error('AWS credentials not configured for SQS');
      }

      const sqsClient = new SQSClient({
        region: 'us-east-1',
        credentials: {
          accessKeyId: env.REMOTION_AWS_ACCESS_KEY_ID,
          secretAccessKey: env.REMOTION_AWS_SECRET_ACCESS_KEY,
        },
      });

      const queueUrl = `https://sqs.us-east-1.amazonaws.com/${env.AWS_ACCOUNT_ID}/remotion-render-queue.fifo`;
      const timestamp = Date.now();
      const results: any[] = [];

      console.log(`📡 Sending ${clips.length} clips to SQS queue: ${queueUrl}`);

      for (const [index, clip] of clips.entries()) {
        try {
          // Generate enhanced filename with title, viral score, and duration
          const filename = generateClipFilename(clip, index);
          
          // ✅ FIXED: Extract analysis folder ID from input video URL
          // Input URL format: "users-data/userId/2025/07/analysis-1753179902-e5e65fa0/result-raw/..."
          const inputPath = clip.s3_video_url;
          const pathParts = inputPath.split('/');
          const analysisFolderIndex = pathParts.findIndex((part: string) => part.startsWith('analysis-'));
          
          let analysisFolder = '';
          if (analysisFolderIndex !== -1) {
            analysisFolder = pathParts[analysisFolderIndex];
          } else {
            // Fallback to pipeline ID if analysis folder not found
            analysisFolder = `pipeline-${pipelineId}`;
          }
          
          const timestamp = Date.now();
          const outputKey = `users-data/${userId}/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}/${analysisFolder}/result-remotion/clip-${index.toString().padStart(2, '0')}-${timestamp}.mp4`;

          const sqsMessage = {
            functionName: "remotion-render-4-0-320-mem3008mb-disk2048mb-600sec",
            serveUrl: "https://remotionlambda-useast1-m9vorb5nmi.s3.us-east-1.amazonaws.com/sites/tiktok-processor-v2",
            composition: "CaptionedVideo",
            inputProps: {
              videoUrl: `https://pub-92b2f2f4576c47a6929f9f0b752833bc.r2.dev/${clip.s3_video_url}`,
              subtitleUrl: `https://pub-92b2f2f4576c47a6929f9f0b752833bc.r2.dev/${clip.s3_captions_url}`,
              durationInSeconds: clip.duration,
              highlightColor: "#39E508",
              backgroundColor: "#FFFFFF", 
              captionSpeed: "medium",
              fontSize: 120,
              fontFamily: "anton"
            },
            codec: "h264",
            imageFormat: "jpeg",
            maxRetries: 1, // REVERTED: Back to 1 retry (original working value)
            privacy: "public",
            outName: {
              bucketName: "ai-clipper-videos",
              key: outputKey, // Using enhanced filename
              s3OutputProvider: {
                endpoint: "https://cd3dd24bd9991cd4300824929326a9de.r2.cloudflarestorage.com",
                accessKeyId: "4eef624649b02ed372635bbe9bf5fc62",
                secretAccessKey: "1da2dd2d0eac552a148fd3d67cfb003507eff69b4bdc9c700378aa6652c2514b"
              }
            },
            webhook: {
              url: `${env.BASE_URL}/api/inngest/remotion-complete`,
              customData: {
                clipId: clip.id,
                pipelineId: pipelineId,
                userId: userId,
                clipIndex: index,
                outputKey: outputKey,
                enhancedFilename: filename // Include the enhanced filename for tracking
              }
            },
            clipId: clip.id,
            batchId: pipelineId
          };

          const command = new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify(sqsMessage),
            MessageGroupId: pipelineId, // All clips in same pipeline use same group
            MessageDeduplicationId: `${clip.id}-${timestamp}`,
            MessageAttributes: {
              clipId: {
                DataType: 'String',
                StringValue: clip.id
              },
              pipelineId: {
                DataType: 'String', 
                StringValue: pipelineId
              },
              composition: {
                DataType: 'String',
                StringValue: sqsMessage.composition
              },
              viralScore: {
                DataType: 'Number',
                StringValue: clip.viral_score.toString()
              }
            }
          });

          const response = await sqsClient.send(command);
          
          console.log(`✅ Clip ${index + 1}/${clips.length} sent to SQS:`);
          console.log(`   Title: "${clip.title}"`);
          console.log(`   Enhanced Filename: "${filename}"`);
          console.log(`   Duration: ${clip.duration}s`);
          console.log(`   Analysis Folder: ${analysisFolder}`);
          console.log(`   Output Path: ${outputKey}`);
          console.log(`   Video URL: https://pub-92b2f2f4576c47a6929f9f0b752833bc.r2.dev/${clip.s3_video_url}`);
          console.log(`   Message ID: ${response.MessageId}`);
          
          results.push({
            clipIndex: index,
            clipId: clip.id,
            title: clip.title,
            duration: clip.duration,
            analysisFolder: analysisFolder,
            outputPath: outputKey,
            messageId: response.MessageId,
            success: true
          });

        } catch (error) {
          console.error(`❌ Failed to send clip ${index + 1}/${clips.length} to SQS:`, error);
          console.error(`   Clip ID: ${clip.id}`);
          console.error(`   Title: "${clip.title}"`);
          console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
          
          results.push({
            clipIndex: index,
            clipId: clip.id,
            title: clip.title,
            error: error instanceof Error ? error.message : String(error),
            success: false
          });
        }
      }

      return results;
    });

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log(`🎯 SQS Queue Summary:`);
    console.log(`   ✅ Successfully queued: ${successCount}/${clips.length} clips`);
    console.log(`   ❌ Failed: ${failCount} clips`);
    console.log(`   📂 Enhanced file naming: ENABLED`);
    console.log(`   🎭 Pipeline: ${pipelineId}`);

    return {
      success: true,
      pipelineId,
      userId,
      totalClips: clips.length,
      successfullyQueued: successCount,
      failed: failCount,
      results,
      message: `Queued ${successCount}/${clips.length} clips for rendering with enhanced naming`
    };
  }
);

// DISABLED: This function has been replaced by the parallel batch processing in parallel-batch-functions.ts
// to avoid dual function triggers and implement proper parallel processing with concurrency limits
/*
// Remotion render function
export const renderWithRemotion = inngest.createFunction(
  {
    id: "render-with-remotion",
    retries: 3,
    concurrency: {
      limit: 8, // Safe concurrency limit for Remotion Lambda
    },
  },
  { event: "remotion.render.queue" }, // Match the event name used in parallel-batch-functions.ts
  async ({ event, step }) => {
    const { clipMetadata, uploadedFileId, userId, fontFamily } = event.data as {
      clipMetadata: ClipMetadata;
      uploadedFileId: string;
      userId: string;
      fontFamily: string;
    };

    console.log(`🎬 Starting Remotion render for clip ${clipMetadata.clip_index}`);
    console.log(`📊 Render info: ${clipMetadata.duration}s, ${clipMetadata.estimated_lambda_count} lambdas`);

    // Use admin client
    const supabase = createSupabaseAdmin();
    let renderJobId: string | undefined = undefined;

    try {
      // First get the clip ID
      const { data: clip, error: clipError } = await supabase
        .from("generated_clips")
        .select("id")
        .eq("pipeline_id", uploadedFileId)
        .eq("clip_index", clipMetadata.clip_index)
        .single();

      if (clipError || !clip) {
        console.error(`❌ Failed to find clip:`, clipError);
        throw new Error(`Failed to find clip: ${clipError?.message || "Clip not found"}`);
      }

      // Create render job record
      renderJobId = await step.run("create-render-job", async () => {
        const { data, error } = await supabase
          .from('render_jobs')
          .insert({
            render_id: `render-${uploadedFileId}-${clipMetadata.clip_index}-${Date.now()}`,
            clip_id: clip.id,
            pipeline_id: uploadedFileId,
            remotion_status: "queued",
            remotion_progress: 0,
            input_video_url: clipMetadata.s3_key,
            input_captions_url: clipMetadata.captions_key,
            lambda_region: "us-east-1",
            estimated_cost: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .select('id')
          .single();

        if (error) {
          console.error(`❌ Failed to create render job:`, error);
          throw new Error(`Failed to create render job: ${error.message}`);
        }

        console.log(`✅ Created render job ${data.id} for clip ${clipMetadata.clip_index}`);
        return data.id;
      });

      // Update clip status
      await step.run("update-clip-status", async () => {
        const { error } = await supabase
          .from("generated_clips")
          .update({
            status: "RENDERING",
            updated_at: new Date().toISOString()
          })
          .eq("id", clip.id);

        if (error) {
          console.error(`❌ Failed to update clip status:`, error);
          throw new Error(`Failed to update clip status: ${error.message}`);
        }
      });

      // Generate output key for R2
      const outputKey = `users-data/${userId}/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}/pipeline-${uploadedFileId}/result-remotion/clip-${clipMetadata.clip_index.toString().padStart(2, '0')}-${Date.now()}.mp4`;

      // Queue Remotion render using API route
      await step.run("queue-remotion-lambda", async () => {
        // Generate R2 public URLs for input files
        const r2PublicAccountId = "92b2f2f4576c47a6929f9f0b752833bc";
        const videoPublicUrl = `https://pub-${r2PublicAccountId}.r2.dev/ai-clipper-videos/${clipMetadata.s3_key}`;
        const captionsPublicUrl = `https://pub-${r2PublicAccountId}.r2.dev/ai-clipper-videos/${clipMetadata.captions_key}`;

        // Calculate optimal frames per lambda with concurrency limit consideration
        const duration = clipMetadata.duration;
        const frameCalc = calculateOptimalFramesPerLambda(duration, 30, 10); // 10 = max concurrency
        const framesPerLambda = frameCalc.framesPerLambda;
        
        console.log(`🧮 Frame calculation for clip ${clipMetadata.clip_index}:`, {
          duration: duration,
          framesPerLambda: frameCalc.framesPerLambda,
          estimatedLambdas: frameCalc.estimatedLambdaCount,
          concurrencyRespected: frameCalc.concurrencyRespected,
          reasoning: frameCalc.reasoning
        });

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
            fontFamily: fontFamily || "anton"
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

        // Update render job with success
        const { error } = await supabase
          .from("render_jobs")
          .update({
            remotion_status: "rendering",
            remotion_render_id: renderId,
            render_started_at: new Date().toISOString(),
            output_s3_key: outputKey,
            updated_at: new Date().toISOString()
          })
          .eq("id", renderJobId);

        if (error) {
          console.error(`❌ Failed to update render job:`, error);
          throw new Error(`Failed to update render job: ${error.message}`);
        }

        // Trigger completion handler
        await inngest.send({
          name: "remotion.render.completed",
          data: {
            renderId: renderId,
            outputKey,
            clipId: clip.id,
            pipelineId: uploadedFileId,
          },
        });

        console.log(`✅ Remotion render queued successfully`);
        console.log(`🎯 Output will be saved to: ai-clipper-videos/${outputKey}`);
      });

      return { success: true, renderJobId };

    } catch (error) {
      console.error(`❌ Remotion render failed:`, error);

      // Update render job with failure
      if (renderJobId) {
        await supabase
          .from("render_jobs")
          .update({
            remotion_status: "failed",
            error_message: error instanceof Error ? error.message : String(error),
            render_started_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("id", renderJobId);
      }

      throw error;
    }
  }
);
*/

// Remotion render completion handler
export const handleRemotionCompletion = inngest.createFunction(
  {
    id: "handle-remotion-completion",
    name: "Handle Remotion Render Completion",
    retries: 3,
  },
  { event: "remotion.render.completed" },
  async ({ event, step }) => {
    const { renderId, outputKey, clipId, pipelineId } = event.data;
    
    // Use admin client to bypass RLS
    const supabase = createSupabaseAdmin();
    
    try {
      // Generate R2 CDN URL
      const r2PublicAccountId = "92b2f2f4576c47a6929f9f0b752833bc";
      const bucketName = "ai-clipper-videos";
      const r2CdnUrl = `https://pub-${r2PublicAccountId}.r2.dev/${bucketName}/${outputKey}`;
      
      // Update render job
      await step.run("update-render-job", async () => {
        const { error } = await supabase
          .from('render_jobs')
          .update({
            remotion_status: "completed",
            render_completed_at: new Date().toISOString(),
            output_r2_url: r2CdnUrl,
            updated_at: new Date().toISOString()
          })
          .eq('render_id', renderId);
          
        if (error) {
          throw new Error(`Failed to update render job: ${error.message}`);
        }
      });
      
      // Update generated clip
      await step.run("update-generated-clip", async () => {
        const { error } = await supabase
          .from('generated_clips')
          .update({
            status: "COMPLETED",
            r2_final_url: r2CdnUrl,
            updated_at: new Date().toISOString()
          })
          .eq('id', clipId);
          
        if (error) {
          throw new Error(`Failed to update generated clip: ${error.message}`);
        }
      });
      
      // Check if all clips are completed
      await step.run("check-pipeline-completion", async () => {
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
      });
      
      return { success: true, r2CdnUrl };
      
    } catch (error) {
      console.error(`Failed to handle Remotion completion:`, error);
      throw error;
    }
  }
);

/**
 * Handle individual clip completion 
 * Updates database and checks if pipeline is complete
 */
export const handleClipCompletion = inngest.createFunction(
  {
    id: "handle-clip-completion",
    retries: 3,
    concurrency: { limit: 1 }, // Reduced to stay within plan limits
  },
  { event: "remotion.clip.completed" },
  async ({ event, step }) => {
    const { 
      type, 
      renderId, 
      clipId, 
      pipelineId, 
      userId, 
      clipIndex, 
      outputKey, 
      r2Url, 
      completedAt 
    } = event.data;

    console.log(`🎬 Handling completion for clip ${clipId} (${clipIndex}) - Status: ${type}`);

    const supabase = createSupabaseAdmin();

    // Step 1: Update render job status
    await step.run("update-render-job", async () => {
      const updateData: any = {
        remotion_status: type === 'success' ? 'completed' : 'failed',
        remotion_progress: type === 'success' ? 100 : 0,
        render_completed_at: completedAt,
        updated_at: new Date().toISOString()
      };

      if (type === 'success' && outputKey) {
        updateData.output_s3_key = outputKey;
        updateData.output_r2_url = r2Url;
      } else if (type === 'error') {
        updateData.error_message = event.data.webhookData?.error || 'Render failed';
      }

      const { error } = await supabase
        .from('render_jobs')
        .update(updateData)
        .eq('clip_id', clipId);

      if (error) {
        console.error(`❌ Failed to update render job for clip ${clipId}:`, error);
        throw new Error(`Failed to update render job: ${error.message}`);
      }

      console.log(`✅ Render job updated for clip ${clipId}: ${type}`);
    });

    // Step 2: Update generated clip status
    await step.run("update-clip-status", async () => {
      const updateData: any = {
        status: type === 'success' ? 'COMPLETED' : 'FAILED',
        updated_at: new Date().toISOString()
      };

      if (type === 'success' && r2Url) {
        updateData.r2_final_url = r2Url;
      }

      const { error } = await supabase
        .from('generated_clips')
        .update(updateData)
        .eq('id', clipId);

      if (error) {
        console.error(`❌ Failed to update clip status for ${clipId}:`, error);
        throw new Error(`Failed to update clip status: ${error.message}`);
      }

      console.log(`✅ Clip status updated: ${clipId} -> ${type}`);
    });

    // Step 3: Check if pipeline is complete
    const pipelineComplete = await step.run("check-pipeline-completion", async () => {
      // Get all clips for this pipeline
      const { data: clips, error } = await supabase
        .from('generated_clips')
        .select('id, status')
        .eq('pipeline_id', pipelineId);

      if (error) {
        console.error(`❌ Failed to fetch clips for pipeline ${pipelineId}:`, error);
        return false;
      }

      const totalClips = clips?.length || 0;
      const completedClips = clips?.filter(c => c.status === 'COMPLETED').length || 0;
      const failedClips = clips?.filter(c => c.status === 'FAILED').length || 0;
      const inProgress = clips?.filter(c => !['COMPLETED', 'FAILED'].includes(c.status)).length || 0;

      console.log(`📊 Pipeline ${pipelineId} status: ${completedClips} completed, ${failedClips} failed, ${inProgress} in progress (${totalClips} total)`);

      // Check if all clips are done (completed or failed)
      if (completedClips + failedClips === totalClips && totalClips > 0) {
        console.log(`🎉 Pipeline ${pipelineId} is complete!`);
        return { 
          complete: true, 
          totalClips, 
          completedClips, 
          failedClips 
        };
      }

      return { 
        complete: false, 
        totalClips, 
        completedClips, 
        failedClips, 
        inProgress 
      };
    });

    // Step 4: If pipeline is complete, trigger completion event
    if (pipelineComplete && typeof pipelineComplete === 'object' && pipelineComplete.complete) {
      await step.run("trigger-pipeline-completion", async () => {
        const inngestResult = await inngest.send({
          name: "remotion.pipeline.complete",
          data: {
            pipelineId,
            userId,
            totalClips: pipelineComplete.totalClips,
            completedClips: pipelineComplete.completedClips,
            failedClips: pipelineComplete.failedClips,
            completedAt: new Date().toISOString()
          }
        });

        console.log(`🚀 Pipeline completion event triggered: ${inngestResult.ids[0]}`);
        return inngestResult.ids[0];
      });
    }

    return {
      success: true,
      clipId,
      pipelineId,
      status: type,
      pipelineComplete: pipelineComplete && typeof pipelineComplete === 'object' ? pipelineComplete.complete : false,
      stats: pipelineComplete
    };
  }
);

/**
 * Handle pipeline completion
 * Updates pipeline status and notifies user
 */
export const handlePipelineCompletion = inngest.createFunction(
  {
    id: "handle-pipeline-completion",
    retries: 2,
    concurrency: { limit: 2 }, // Reduced to stay within plan limits
  },
  { event: "remotion.pipeline.complete" },
  async ({ event, step }) => {
    const { 
      pipelineId, 
      userId, 
      totalClips, 
      completedClips, 
      failedClips, 
      completedAt 
    } = event.data;

    console.log(`🎉 Handling pipeline completion: ${pipelineId}`);
    console.log(`📊 Final stats: ${completedClips}/${totalClips} completed, ${failedClips} failed`);

    const supabase = createSupabaseAdmin();

    // Step 1: Update pipeline status
    await step.run("update-pipeline-status", async () => {
      const { error } = await supabase
        .from('pipelines')
        .update({
          status: 'COMPLETED',
          phase3_completed_at: completedAt,
          successful_clips: completedClips,
          failed_clips: failedClips,
          updated_at: new Date().toISOString()
        })
        .eq('id', pipelineId);

      if (error) {
        console.error(`❌ Failed to update pipeline status for ${pipelineId}:`, error);
        throw new Error(`Failed to update pipeline status: ${error.message}`);
      }

      console.log(`✅ Pipeline ${pipelineId} marked as COMPLETED`);
    });

    // Step 2: Log completion summary
    await step.run("log-completion-summary", async () => {
      console.log(`\n🎯 PIPELINE COMPLETION SUMMARY:`);
      console.log(`   Pipeline ID: ${pipelineId}`);
      console.log(`   User ID: ${userId}`);
      console.log(`   Total Clips: ${totalClips}`);
      console.log(`   Completed: ${completedClips}`);
      console.log(`   Failed: ${failedClips}`);
      console.log(`   Success Rate: ${((completedClips / totalClips) * 100).toFixed(1)}%`);
      console.log(`   Completed At: ${completedAt}`);

      return {
        pipelineId,
        userId,
        totalClips,
        completedClips,
        failedClips,
        successRate: ((completedClips / totalClips) * 100)
      };
    });

    // Step 3: Prepare completion data for frontend
    const completionData = await step.run("prepare-completion-data", async () => {
      // Get all completed clips with their R2 URLs
      const { data: clips, error } = await supabase
        .from('generated_clips')
        .select('id, title, viral_score, duration, r2_final_url, status, clip_index')
        .eq('pipeline_id', pipelineId)
        .order('clip_index');

      if (error) {
        console.error(`❌ Failed to fetch clips for completion data:`, error);
        return null;
      }

      const completedClipsList = clips?.filter(c => c.status === 'COMPLETED') || [];
      const failedClipsList = clips?.filter(c => c.status === 'FAILED') || [];

      return {
        totalClips: clips?.length || 0,
        completedClips: completedClipsList.length,
        failedClips: failedClipsList.length,
        clips: completedClipsList,
        failedClipIds: failedClipsList.map(c => c.id)
      };
    });

    console.log(`✅ Pipeline ${pipelineId} completion handled successfully`);
    console.log(`🔗 ${completionData?.completedClips || 0} videos ready for download`);

    return {
      success: true,
      pipelineId,
      userId,
      completionData,
      message: `Pipeline completed with ${completedClips}/${totalClips} clips successful`
    };
  }
);
