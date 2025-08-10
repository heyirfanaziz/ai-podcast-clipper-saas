"use client";

import { useEffect, useState } from "react";
import { useSupabaseAuth } from "~/components/auth/supabase-auth-provider";
import { supabase } from "~/lib/supabase";
import { DashboardClient } from "~/components/dashboard-client";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

type UserProfile = {
  id: string;
  email: string;
  full_name: string | null;
  credits: number;
  daily_requests: number;
  daily_limit: number;
  concurrent_jobs: number;
  concurrent_limit: number;
}

type Pipeline = {
  id: string;
  run_id: string;
  status: string;
  youtube_url: string;
  total_clips: number;
  successful_clips: number;
  failed_clips: number;
  created_at: string;
  clips: GeneratedClip[];
}

type GeneratedClip = {
  id: string;
  title: string;
  viral_score: number;
  duration: number;
  r2_final_url: string | null;
  status: string;
  created_at: string;
  s3_video_url: string | null; // FIXED: Add s3_video_url field
}

export default function DashboardPage() {
  const { user, loading } = useSupabaseAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [clips, setClips] = useState<GeneratedClip[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (loading) return;
    
    if (!user) {
      router.push('/login');
      return;
    }

    loadUserData();
  }, [user, loading, router]);

  // Handle success parameter from Stripe checkout
  useEffect(() => {
    const success = searchParams.get('success');
    if (success === 'true') {
      toast.success('Payment successful! Credits have been added to your account.');
      
      // Refresh user data to show updated credits
      setTimeout(() => {
        loadUserData();
      }, 2000); // Increased delay to ensure webhook has processed
      
      // Clean up the URL
      const url = new URL(window.location.href);
      url.searchParams.delete('success');
      window.history.replaceState({}, '', url.toString());
    }
  }, [searchParams]);

  // Real-time credit refresh - check for credit updates every 30 seconds
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(() => {
      loadUserData();
    }, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [user]);

  const loadUserData = async () => {
    if (!user) return;

    try {
      console.log('🔍 Loading user data for user ID:', user.id);
      console.log('📧 User email:', user.email);
      
      // Load user profile
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      console.log('📊 Profile query result:', { profile, profileError });

      if (profileError) {
        console.error('❌ Error loading user profile:', profileError);
        console.error('❌ Error code:', profileError.code);
        console.error('❌ Error message:', profileError.message);
        console.error('❌ Error details:', profileError.details);
        
        // If profile doesn't exist, try to create it manually
        if (profileError.code === 'PGRST116') {
          console.log('👤 Profile not found, creating manually...');
          
          const { data: newProfile, error: createError } = await supabase
            .from('user_profiles')
            .insert({
              id: user.id,
              email: user.email!,
              full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
              avatar_url: user.user_metadata?.avatar_url || null,
              credits: 100,
              daily_requests: 0,
              daily_limit: 50,
              concurrent_jobs: 0,
              concurrent_limit: 3,
              is_blocked: false,
              stripe_customer_id: null,
            })
            .select('*')
            .single();
            
          if (createError) {
            console.error('❌ Failed to create profile manually:', createError);
            return;
          }
          
          console.log('✅ Created profile manually:', newProfile);
          setUserProfile(newProfile);
        }
        return;
      }

      console.log('✅ Profile loaded successfully:', profile);
      setUserProfile(profile);

      // Load pipelines with clips
      const { data: pipelinesData, error: pipelinesError } = await supabase
        .from('pipelines')
        .select(`
          *,
          clips:generated_clips(
            id,
            title,
            viral_score,
            duration,
            r2_final_url,
            status,
            created_at
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (pipelinesError) {
        console.error('Error loading pipelines:', pipelinesError);
        return;
      }

      setPipelines(pipelinesData || []);

      // Load all clips
      const { data: clipsData, error: clipsError } = await supabase
        .from('generated_clips')
        .select('id, title, viral_score, duration, r2_final_url, status, created_at, s3_video_url')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false});

      if (clipsError) {
        console.error('Error loading clips:', clipsError);
        return;
      }

      setClips(clipsData || []);
    } catch (error) {
      console.error('❌ Unexpected error loading user data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (loading || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  // If no user or profile, the useEffect will handle the redirect
  // Just show loading while redirect happens
  if (!user || !userProfile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  // Transform data to match the expected format
  const transformedFiles = pipelines.map(p => ({
    id: p.id,
    s3Key: p.run_id,
    filename: `Pipeline ${p.run_id}`,
    status: p.status,
    clipsCount: p.successful_clips,
    createdAt: new Date(p.created_at),
    youtubeUrl: p.youtube_url // <-- add this
  }));

  const transformedClips = clips.map(c => ({
    id: c.id,
    title: c.title,
    s3Key: c.id, // placeholder
    viralScore: c.viral_score,
    createdAt: new Date(c.created_at),
    updatedAt: new Date(c.created_at),
    uploadedFileId: null,
    userId: user.id,
    status: c.status, // FIXED: Add status field for filtering
    r2_final_url: c.r2_final_url, // FIXED: Add r2_final_url for filtering
    s3_video_url: c.s3_video_url, // FIXED: Add s3_video_url as fallback
  }));

  return (
    <DashboardClient
      uploadedFiles={transformedFiles}
      clips={transformedClips}
      userId={user.id}
      userProfile={userProfile}
    />
  );
}
