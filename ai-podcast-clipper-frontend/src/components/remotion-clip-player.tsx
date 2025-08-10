"use client";

import type { Clip } from "~/types/clip";
import { Download, Loader2, Play, RotateCcw, ExternalLink } from "lucide-react";
import { useEffect, useState, useRef, useCallback } from "react";
import { getClipPlayUrl } from "~/actions/generation";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";

function ShadcnClipCard({ clip }: { clip: Clip }) {
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [isLoadingUrl, setIsLoadingUrl] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasError, setHasError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const fetchPlayUrl = useCallback(async () => {
    try {
      setHasError(false);
      const result = await getClipPlayUrl(clip.id);
      if (result.succes && result.url) {
        setPlayUrl(result.url);
      } else if (result.error) {
        console.error("Failed to get play url: " + result.error);
        setHasError(true);
      }
    } catch (error) {
      console.error("Error fetching play URL:", error);
      setHasError(true);
    } finally {
      setIsLoadingUrl(false);
      setIsRefreshing(false);
    }
  }, [clip.id]);

  useEffect(() => {
    void fetchPlayUrl();
  }, [fetchPlayUrl]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchPlayUrl();
  };

  const handleDownload = () => {
    if (playUrl) {
      const link = document.createElement("a");
      link.href = playUrl;
      link.download = `clip-${clip.id}.mp4`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleOpenInNewTab = () => {
    if (playUrl) {
      window.open(playUrl, '_blank');
    }
  };

  // Extract clip info from s3Key
  const clipInfo = clip.s3Key.split('/');
  const clipName = clipInfo[clipInfo.length - 1] ?? 'Unknown';
  const folderName = clipInfo[clipInfo.length - 2] ?? 'Unknown';

  return (
    <Card className="group hover:shadow-lg transition-all duration-200 border-border/50 hover:border-border py-0">
      <CardContent className="p-4 space-y-4">
        {/* Header with Title and Viral Score */}
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-sm line-clamp-2 leading-tight">
              {clip.title || clipName}
            </h3>
            <Badge 
              variant={clip.viralScore && clip.viralScore >= 70 ? "default" : "outline"}
              className="text-xs whitespace-nowrap ml-2"
            >
              {clip.viralScore ? `${clip.viralScore}%` : folderName.slice(-8)}
            </Badge>
          </div>
        </div>

        {/* Video Preview */}
        <div className="relative rounded-lg overflow-hidden aspect-[9/16] bg-muted/50">
          {isLoadingUrl ? (
            <div className="flex h-full w-full items-center justify-center bg-muted">
              <div className="text-center space-y-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">Loading video...</p>
              </div>
            </div>
          ) : hasError ? (
            <div className="flex h-full w-full items-center justify-center bg-muted">
              <div className="text-center space-y-3">
                <Play className="h-10 w-10 opacity-30 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">Failed to load</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          ) : playUrl ? (
            <>
              <video
                ref={videoRef}
                src={playUrl}
                controls
                preload="metadata"
                className="w-full h-full object-cover rounded-lg"
                crossOrigin="anonymous"
                playsInline
                onError={() => setHasError(true)}
              />
              {/* Overlay with refresh button */}
              <div className="absolute top-2 right-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="h-8 w-8 p-0 bg-black/60 hover:bg-black/80 text-white"
                >
                  {isRefreshing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted">
              <Play className="h-10 w-10 opacity-30 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button 
            onClick={handleDownload} 
            variant="default" 
            size="sm" 
            disabled={!playUrl}
            className="flex-1"
          >
            <Download className="mr-1.5 h-4 w-4" />
            Download
          </Button>
          <Button
            onClick={handleOpenInNewTab}
            variant="outline"
            size="sm"
            disabled={!playUrl}
            className="px-3"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function RemotionClipDisplay({ clips }: { clips: Clip[] }) {
  // Only show clips that are COMPLETED and have a result-remotion/ video
  const renderedClips = clips.filter(
    (clip) =>
      clip.status === "COMPLETED" &&
      ((clip.r2_final_url && clip.r2_final_url.includes('/result-remotion/')) ||
       (clip.s3_video_url && clip.s3_video_url.includes('/result-remotion/')))
  );

  if (renderedClips.length === 0) {
    return (
      <div className="text-center py-12">
        <Play className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
        <h3 className="text-lg font-medium text-muted-foreground mb-2">No clips generated yet</h3>
        <p className="text-sm text-muted-foreground">
          Upload a video or process a YouTube URL to get started
        </p>
      </div>
    );
  }
  
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {renderedClips.map((clip) => (
        <ShadcnClipCard key={clip.id} clip={clip} />
      ))}
    </div>
  );
} 