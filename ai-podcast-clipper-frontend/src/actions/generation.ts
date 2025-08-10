"use server";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { revalidatePath } from "next/cache";
import { env } from "~/env";
import { inngest } from "~/inngest/client";
import { supabase } from "~/lib/supabase";
import { createSupabaseServer, createSupabaseAdmin } from "~/lib/supabase-server";

export async function processVideo(uploadedFileId: string) {
  // Use admin client to bypass RLS policies
  const supabaseAdmin = createSupabaseAdmin();

  // Check if pipeline exists and is not uploaded yet
  const { data: pipeline, error } = await supabaseAdmin
    .from('pipelines')
    .select('status, id')
    .eq('id', uploadedFileId)
    .single();

  if (error || !pipeline) {
    throw new Error("Pipeline not found");
  }

  if (pipeline.status !== 'pending') return;

  // Get user info for this pipeline
  const { data: pipelineWithUser, error: userError } = await supabaseAdmin
    .from('pipelines')
    .select('user_id')
    .eq('id', uploadedFileId)
    .single();

  if (userError || !pipelineWithUser) {
    throw new Error("Pipeline user not found");
  }

  await inngest.send({
    name: "process-video-events",
    data: { uploadedFileId: uploadedFileId, userId: pipelineWithUser.user_id },
  });

  // Update pipeline status
  await supabaseAdmin
    .from('pipelines')
    .update({ status: 'processing' })
    .eq('id', uploadedFileId);

  revalidatePath("/dashboard");
}

export async function processYouTubeVideo(youtubeUrl: string, fontFamily = "anton", userId?: string) {
  try {
    if (!userId) {
      throw new Error("User ID is required");
    }

    // Use admin client to bypass RLS policies
    const supabaseAdmin = createSupabaseAdmin();

    // Create a pipeline record in Supabase
    const runId = `yt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const { data: pipeline, error } = await supabaseAdmin
      .from('pipelines')
      .insert({
        run_id: runId,
        user_id: userId,
        youtube_url: youtubeUrl,
        font_family: fontFamily,
        status: 'pending'
      })
      .select()
      .single();

    if (error || !pipeline) {
      throw new Error(`Failed to create pipeline: ${error?.message}`);
    }

    console.log(`🎯 Created YouTube pipeline with ID: ${pipeline.id}`);
    console.log(`📁 Run ID: ${runId}`);
    console.log(`🚀 Backend will process: ${youtubeUrl}`);

    // Send to Inngest for parallel batch processing
    await inngest.send({
      name: "youtube.video.process",
      data: { 
        uploadedFileId: pipeline.id, // Using pipeline ID for consistency with old system
        youtubeUrl: youtubeUrl,
        userId: userId,
        fontFamily: fontFamily
      },
    });

    revalidatePath("/dashboard");
    return { success: true, uploadedFileId: pipeline.id };
  } catch (error) {
    console.error("❌ processYouTubeVideo error:", error);
    console.error("❌ Error details:", {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : 'No stack trace',
      youtubeUrl,
      fontFamily
    });
    throw error;
  }
}

export async function getClipPlayUrl(
  clipId: string,
): Promise<{ succes: boolean; url?: string; error?: string }> {
  try {
    // Use admin client to bypass RLS policies
    const supabaseAdmin = createSupabaseAdmin();

    // Get clip from Supabase
    const { data: clip, error } = await supabaseAdmin
      .from('generated_clips')
      .select('r2_final_url, s3_video_url, title')
      .eq('id', clipId)
      .single();

    if (error || !clip) {
      return { succes: false, error: "Clip not found" };
    }

    // Use R2 URL if available (preferred)
    if (clip.r2_final_url) {
      // Only use if it starts with the correct R2 CDN prefix and /users-data
      const validPrefix = 'https://pub-92b2f2f4576c47a6929f9f0b752833bc.r2.dev/users-data';
      if (clip.r2_final_url.startsWith(validPrefix)) {
        console.log(`🌍 Using R2 CDN URL for clip: ${clip.title}`);
        return { succes: true, url: clip.r2_final_url };
      } else {
        console.warn(`⚠️ r2_final_url is present but invalid, reconstructing: ${clip.r2_final_url}`);
        // Fall through to construct from s3_video_url
      }
    }

    // Fallback: Construct R2 CDN URL from S3 key if available
    if (clip.s3_video_url) {
      const r2PublicAccountId = "92b2f2f4576c47a6929f9f0b752833bc";
      // Remove any leading slash from s3_video_url to avoid double slashes
      const key = clip.s3_video_url.startsWith('/') ? clip.s3_video_url.slice(1) : clip.s3_video_url;
      const r2CdnUrl = `https://pub-${r2PublicAccountId}.r2.dev/${key}`;
      console.log(`🌍 Constructed fallback R2 CDN URL: ${r2CdnUrl}`);
      return { succes: true, url: r2CdnUrl };
    }

    return { succes: false, error: "No video URL available for this clip" };
  } catch (error) {
    console.error(`❌ Error generating clip URL:`, error);
    return { succes: false, error: "Failed to generate play URL." };
  }
}

export async function generateClips(
  s3Key: string,
  displayName: string,
  userId: string,
  credits: number,
  uploadedFileId: string,
) {
  const supabase = createSupabaseAdmin();

  // Verify user exists and check credits
  const { data: userProfile, error: userError } = await supabase
    .from('user_profiles')
    .select('credits, is_blocked')
    .eq('id', userId)
    .single();

  if (userError || !userProfile) {
    throw new Error("User not found");
  }

  if (userProfile.is_blocked) {
    throw new Error("Account blocked");
  }

  if (userProfile.credits < credits) {
    throw new Error("Insufficient credits");
  }

  // ⚠️ REMOVED UPFRONT CREDIT DEDUCTION TO PREVENT DOUBLE CHARGING
  // Credits will be deducted at the end of processing in functions.ts
  // This prevents the double-deduction bug where users lose 2x credits
  
  console.log(`💳 User has ${userProfile.credits} credits, pipeline requires ~${credits} credits`);

  // Create a new pipeline record for the processing job
  const runId = `gen-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const { data: pipeline, error: pipelineError } = await supabase
    .from('pipelines')
    .insert({
      run_id: runId,
      user_id: userId,
      s3_key_prefix: s3Key,
      display_name: displayName,
      status: 'pending',
      estimated_cost: credits, // Store estimated cost for later deduction
    })
    .select('id, run_id')
    .single();

  if (pipelineError || !pipeline) {
    throw new Error(`Failed to create pipeline: ${pipelineError?.message}`);
  }

  // Send event to Inngest
  await inngest.send({
    name: "audio/process",
    data: {
      audioUrl: `https://${env.S3_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com/${s3Key}`,
      displayName,
      userId,
      pipelineId: pipeline.id,
      runId: pipeline.run_id,
      credits,
    },
  });

  return {
    success: true,
    pipelineId: pipeline.id,
    runId: pipeline.run_id,
  };
}
