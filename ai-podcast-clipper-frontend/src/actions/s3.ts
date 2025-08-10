"use server";

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createSupabaseServer } from "~/lib/supabase-server";
import { env } from "~/env";
import { v4 as uuidv4 } from "uuid";

const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

export async function generateUploadUrl(fileInfo: {
  filename: string;
  contentType: string;
  userId: string;
}): Promise<{
  success: boolean;
  signedUrl: string;
  key: string;
  uploadedFileId: string;
}> {
  if (!fileInfo.userId) throw new Error("User ID is required");

  const supabase = await createSupabaseServer();
  
  // Verify user exists
  const { data: user, error: userError } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('id', fileInfo.userId)
    .single();

  if (userError || !user) {
    throw new Error("User not found");
  }

  const fileExtension = fileInfo.filename.split(".").pop() ?? "";
  const uniqueId = uuidv4();
  const key = `${uniqueId}/original.${fileExtension}`;

  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET_NAME,
    Key: key,
    ContentType: fileInfo.contentType,
  });

  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 600 });
  
  // Create a pipeline record in Supabase for the file upload
  const runId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const { data: pipeline, error } = await supabase
    .from('pipelines')
    .insert({
      run_id: runId,
      user_id: fileInfo.userId,
      s3_key_prefix: key,
      display_name: fileInfo.filename,
      status: 'pending'
    })
    .select('id')
    .single();

  if (error || !pipeline) {
    throw new Error(`Failed to create pipeline: ${error?.message}`);
  }

  return {
    success: true,
    signedUrl,
    key,
    uploadedFileId: pipeline.id,
  };
}

export async function createPresignedUrl(
  fileName: string,
  fileType: string,
  userId: string,
) {
  const supabase = await createSupabaseServer();
  
  // Verify user exists
  const { data: user, error } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('id', userId)
    .single();

  if (error || !user) {
    throw new Error("User not found");
  }

  const key = `uploads/${userId}/${Date.now()}-${fileName}`;

  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET_NAME,
    Key: key,
    ContentType: fileType,
  });

  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
  
  return { signedUrl, key };
}
