export interface Clip {
  id: string;
  title: string;
  s3Key: string;
  viralScore: number;
  createdAt: Date;
  updatedAt: Date;
  uploadedFileId: string | null;
  userId: string;
  status?: string; // FIXED: Add status for filtering
  r2_final_url?: string | null; // FIXED: Add r2_final_url for filtering
  s3_video_url?: string | null; // FIXED: Add s3_video_url as fallback
} 