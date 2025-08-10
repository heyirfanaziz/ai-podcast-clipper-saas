"use client";

import Dropzone, { type DropzoneState } from "shadcn-dropzone";
import type { Clip } from "~/types/clip";
import Link from "next/link";
import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Loader2, UploadCloud, Youtube } from "lucide-react";
import { useState, useEffect } from "react";
import { generateUploadUrl } from "~/actions/s3";
import { toast } from "sonner";
import { processVideo, processYouTubeVideo } from "~/actions/generation";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Badge } from "./ui/badge";
import { useRouter } from "next/navigation";
import { RemotionClipDisplay } from "./remotion-clip-player";

export function DashboardClient({
  uploadedFiles,
  clips,
  userId,
  userProfile,
}: {
  uploadedFiles: {
    id: string;
    s3Key: string;
    filename: string;
    status: string;
    clipsCount: number;
    createdAt: Date;
    youtubeUrl?: string;
  }[];
  clips: Clip[];
  userId: string;
  userProfile?: {
    id: string;
    email: string;
    full_name: string | null;
    credits: number;
    daily_requests: number;
    daily_limit: number;
    concurrent_jobs: number;
    concurrent_limit: number;
  };
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [processingYoutube, setProcessingYoutube] = useState(false);
  const [selectedFont, setSelectedFont] = useState("anton");

  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  // Auto-refresh when there are processing files
  useEffect(() => {
    const hasProcessingFiles = uploadedFiles.some(file => 
      ['queued', 'downloading', 'transcribing', 'analyzing', 'processing'].includes(file.status)
    );

    if (hasProcessingFiles) {
      const interval = setInterval(() => {
        console.log('🔄 Auto-refreshing dashboard due to processing files...');
        router.refresh();
      }, 30000); // Refresh every 30 seconds

      return () => clearInterval(interval);
    }
  }, [uploadedFiles, router]);

  const handleRefresh = async () => {
    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 600);
  };

  const handleDrop = (acceptedFiles: File[]) => {
    setFiles(acceptedFiles);
  };

  const handleUpload = async () => {
    if (files.length === 0) return;

    const file = files[0]!;
    setUploading(true);

    try {
      const { success, signedUrl, uploadedFileId } = await generateUploadUrl({
        filename: file.name,
        contentType: file.type,
        userId: userId,
      });

      if (!success) throw new Error("Failed to get upload URL");

      const uploadResponse = await fetch(signedUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type,
        },
      });

      if (!uploadResponse.ok)
        throw new Error(`Upload filed with status: ${uploadResponse.status}`);

      await processVideo(uploadedFileId);

      setFiles([]);

      toast.success("Video uploaded successfully", {
        description:
          "Your video has been scheduled for processing. Check the status below.",
        duration: 5000,
      });
    } catch (error) {
      toast.error("Upload failed", {
        description:
          "There was a problem uploading your video. Please try again.",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleYouTubeProcess = async () => {
    if (!youtubeUrl.trim()) return;

    setProcessingYoutube(true);

    try {
      const result = await processYouTubeVideo(youtubeUrl, selectedFont, userId);

      if (result.success) {
        setYoutubeUrl("");
        setSelectedFont("anton"); // Reset to default
        toast.success("YouTube video processing started", {
          description:
            `Your YouTube video has been scheduled for processing with ${selectedFont} font captions. Check the status below.`,
          duration: 5000,
        });
      }
    } catch (error) {
      toast.error("Processing failed", {
        description:
          "There was a problem processing your YouTube video. Please check the URL and try again.",
      });
    } finally {
      setProcessingYoutube(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col space-y-6 px-4 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Auclip
          </h1>
          <p className="text-muted-foreground">
            Upload your podcast and get AI-generated clips instantly
          </p>
        </div>
        <div className="flex items-center gap-4">
          {userProfile && (
            <div className="text-right">
              <p className="text-sm font-medium">{userProfile.credits} Credits</p>
              <p className="text-xs text-muted-foreground">
                {userProfile.daily_requests}/{userProfile.daily_limit} daily requests
              </p>
            </div>
          )}
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Refresh'
            )}
          </Button>
          <Link href="/dashboard/billing">
            <Button>Buy Credits</Button>
          </Link>
        </div>
      </div>

      <Tabs defaultValue="upload">
        <TabsList>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="my-clips">My Clips</TabsTrigger>
        </TabsList>

        <TabsContent value="upload">
          <div className="space-y-6">
            {/* YouTube URL Input */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Youtube className="h-5 w-5 text-red-500" />
                  Process YouTube Video
                </CardTitle>
                <CardDescription>
                  Enter a YouTube URL to automatically download and process the video with professional TikTok-style captions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="youtube-url">YouTube URL</Label>
                    <Input
                      id="youtube-url"
                      placeholder="https://www.youtube.com/watch?v=..."
                      value={youtubeUrl}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      disabled={processingYoutube}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="font-select">Caption Font</Label>
                    <select
                      id="font-select"
                      value={selectedFont}
                      onChange={(e) => setSelectedFont(e.target.value)}
                      disabled={processingYoutube}
                      className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="anton">Anton - Bold & Impact (Recommended)</option>
                      <option value="poppins">Poppins - Modern & Clean</option>
                      <option value="montserrat">Montserrat - Professional</option>
                      <option value="oswald">Oswald - Strong & Condensed</option>
                      <option value="roboto">Roboto - Clean & Readable</option>
                    </select>
                    <p className="text-sm text-muted-foreground">
                      Choose the font style for your TikTok-style captions. Anton is recommended for maximum impact.
                    </p>
                  </div>

                  <Button
                    onClick={handleYouTubeProcess}
                    disabled={!youtubeUrl.trim() || processingYoutube}
                    className="w-full"
                  >
                    {processingYoutube ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing YouTube Video...
                      </>
                    ) : (
                      <>
                        <Youtube className="mr-2 h-4 w-4" />
                        Process YouTube Video
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* File Upload */}
            <Card>
              <CardHeader>
                <CardTitle>Upload File</CardTitle>
                <CardDescription>
                  Or upload your own audio or video file to generate clips
                </CardDescription>
              </CardHeader>
              <CardContent>
              <Dropzone
                onDrop={handleDrop}
                accept={{ "video/mp4": [".mp4"] }}
                maxSize={500 * 1024 * 1024}
                disabled={uploading}
                maxFiles={1}
              >
                {(dropzone: DropzoneState) => (
                  <>
                    <div className="flex flex-col items-center justify-center space-y-4 rounded-lg p-10 text-center">
                      <UploadCloud className="text-muted-foreground h-12 w-12" />
                      <p className="font-medium">Drag and drop your file</p>
                      <p className="text-muted-foreground text-sm">
                        or click to browse (MP4 up to 500MB)
                      </p>
                      <Button
                        className="cursor-pointer"
                        variant="default"
                        size="sm"
                        disabled={uploading}
                      >
                        Select File
                      </Button>
                    </div>
                  </>
                )}
              </Dropzone>

              <div className="mt-2 flex items-start justify-between">
                <div>
                  {files.length > 0 && (
                    <div className="space-y-1 text-sm">
                      <p className="font-medium">Selected file:</p>
                      {files.map((file) => (
                        <p key={file.name} className="text-muted-foreground">
                          {file.name}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  disabled={files.length === 0 || uploading}
                  onClick={handleUpload}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    "Upload and Generate Clips"
                  )}
                </Button>
              </div>

                <div className="pt-6">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-md mb-2 font-medium">Queue status</h3>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRefresh}
                      disabled={refreshing}
                    >
                      {refreshing && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Refresh
                    </Button>
                  </div>
                  <div className="max-h-[300px] overflow-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                        <TableHead className="w-16">#</TableHead>
                          <TableHead>File</TableHead>
                          <TableHead>Uploaded</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Clips created</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                      {uploadedFiles.length > 0 ? (
                        uploadedFiles.map((item, index) => (
                          <TableRow key={item.id}>
                            <TableCell className="w-16 text-muted-foreground">
                              {index + 1}
                            </TableCell>
                            <TableCell className="max-w-xs truncate font-medium">
                              {item.youtubeUrl ? (
                                <a href={item.youtubeUrl} target="_blank" rel="noopener noreferrer" >
                                  {item.youtubeUrl}
                                </a>
                              ) : (
                                item.filename
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {new Date(item.createdAt).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              {item.status === "queued" && (
                                <Badge variant="outline">Queued</Badge>
                              )}
                              {item.status === "downloading" && (
                                <Badge variant="outline">Downloading</Badge>
                              )}
                              {item.status === "transcribing" && (
                                <Badge variant="outline">Transcribing</Badge>
                              )}
                              {item.status === "analyzing" && (
                                <Badge variant="outline">Analyzing</Badge>
                              )}
                              {item.status === "processing" && (
                                <Badge variant="outline">Processing</Badge>
                              )}
                              {item.status === "processed" && (
                                <Badge variant="outline">Processed</Badge>
                              )}
                              {item.status === "no credits" && (
                                <Badge variant="destructive">No credits</Badge>
                              )}
                              {item.status === "no_clips_found" && (
                                <Badge variant="secondary">No clips found</Badge>
                              )}
                              {item.status === "failed" && (
                                <Badge variant="destructive">Failed</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {item.clipsCount > 0 ? (
                                <span>
                                  {item.clipsCount} clip
                                  {item.clipsCount !== 1 ? "s" : ""}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">
                                  No clips yet
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                            No videos in queue yet. Upload a file or process a YouTube video to get started.
                          </TableCell>
                        </TableRow>
                      )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
            </CardContent>
          </Card>
          </div>
        </TabsContent>

        <TabsContent value="my-clips">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>My Clips</CardTitle>
                  <CardDescription>
                    View and manage your generated clips here. Processing may take a
                    few minutes.
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={refreshing}
                >
                  {refreshing && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <RemotionClipDisplay clips={clips} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
