/**
 * Production Pipeline API Route
 * Handles 1000 requests/day with intelligent queue management
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { inngest } from "../../../inngest/client";
import { z } from "zod";

// Request validation schema
const ProductionPipelineRequest = z.object({
  youtube_url: z.string().url("Invalid YouTube URL"),
  font_family: z.string().default("anton"),
});

export async function POST(request: NextRequest) {
  try {
    console.log("🚀 PRODUCTION PIPELINE REQUEST");
    
    // 1. Extract user ID from request (passed from client)
    const body = await request.json();
    const { userId, ...requestData } = body;
    
    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 401 }
      );
    }

    console.log(`👤 USER: ${userId}`);

    // 2. Parse and validate request
    const validatedData = ProductionPipelineRequest.parse(requestData);

    // 3. Check user quota
    const quotaCheck = await checkUserQuota(userId);
    if (!quotaCheck.allowed) {
      return NextResponse.json(
        { error: quotaCheck.reason },
        { status: 429 }
      );
    }

    // 4. Check system capacity
    const systemCheck = await checkSystemCapacity();
    if (!systemCheck.allowed) {
      return NextResponse.json(
        { error: systemCheck.reason },
        { status: 503 }
      );
    }

    // 5. Create pipeline record
    const pipeline = await createPipelineRecord(
      userId,
      validatedData.youtube_url,
      validatedData.font_family
    );

    console.log(`📊 PIPELINE CREATED: ${pipeline.runId}`);

    // 6. Update user quota
    await updateUserQuota(userId, 1, 1); // +1 request, +1 concurrent job

    // 7. Trigger Inngest pipeline
    const inngestResult = await inngest.send({
      name: "pipeline/start",
      data: {
        youtube_url: validatedData.youtube_url,
        user_id: userId,
        font_family: validatedData.font_family,
        run_id: pipeline.runId,
      },
    });

    console.log(`🎯 INNGEST TRIGGERED: ${inngestResult.ids[0]}`);

    // 8. Return success response
    return NextResponse.json({
      success: true,
      pipeline: {
        id: pipeline.id,
        runId: pipeline.runId,
        status: "queued",
        estimatedTime: "12-15 minutes",
        inngestId: inngestResult.ids[0],
      },
      quota: {
        dailyRequests: quotaCheck.quota.daily_requests + 1,
        dailyLimit: quotaCheck.quota.daily_limit,
        concurrentJobs: quotaCheck.quota.concurrent_jobs + 1,
      },
      system: {
        activePipelines: systemCheck.metrics.activePipelines + 1,
        capacityUsed: `${((systemCheck.metrics.activePipelines + 1) / 8 * 100).toFixed(1)}%`,
      },
    });

  } catch (error) {
    console.error("❌ PRODUCTION PIPELINE ERROR:", error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get userId from query parameters
    const userId = request.nextUrl.searchParams.get('userId');
    
    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 401 }
      );
    }
    
    // Get user quota
    const userQuota = await getUserQuota(userId);
    
    // Get system metrics
    const systemMetrics = await getSystemMetrics();
    
    // Get user's recent pipelines
    const { data: recentPipelines, error } = await supabase
      .from('pipelines')
      .select(`
        id,
        run_id,
        status,
        created_at,
        total_clips,
        successful_clips,
        estimated_cost,
        generated_clips (
          id,
          status,
          title,
          r2_final_url
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      console.error("❌ Error fetching recent pipelines:", error);
    }

    return NextResponse.json({
      quota: {
        dailyRequests: userQuota.daily_requests,
        dailyLimit: userQuota.daily_limit,
        concurrentJobs: userQuota.concurrent_jobs,
        concurrentLimit: userQuota.concurrent_limit,
        isBlocked: userQuota.is_blocked,
      },
      system: {
        activePipelines: systemMetrics.activePipelines,
        activeRenders: systemMetrics.activeRenders,
        totalDailyRequests: systemMetrics.totalDailyRequests,
        capacityUsed: `${(systemMetrics.activePipelines / 8 * 100).toFixed(1)}%`,
        healthStatus: systemMetrics.systemHealth,
      },
      recentPipelines: (recentPipelines || []).map(p => ({
        id: p.id,
        runId: p.run_id,
        status: p.status,
        createdAt: p.created_at,
        totalClips: p.total_clips,
        successfulClips: p.successful_clips,
        estimatedCost: p.estimated_cost,
        clips: p.generated_clips,
      })),
    });

  } catch (error) {
    console.error("❌ GET PRODUCTION STATUS ERROR:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// =====================================
// HELPER FUNCTIONS
// =====================================

async function checkUserQuota(userId: string): Promise<{
  allowed: boolean;
  reason?: string;
  quota: any;
}> {
  const userQuota = await getUserQuota(userId);
  
  // Check if user is blocked
  if (userQuota.is_blocked) {
    return {
      allowed: false,
      reason: "Account is blocked",
      quota: userQuota,
    };
  }
  
  // Check daily limit
  if (userQuota.daily_requests >= userQuota.daily_limit) {
    return {
      allowed: false,
      reason: "Daily request limit exceeded",
      quota: userQuota,
    };
  }
  
  // Check concurrent limit
  if (userQuota.concurrent_jobs >= userQuota.concurrent_limit) {
    return {
      allowed: false,
      reason: "Concurrent job limit exceeded",
      quota: userQuota,
    };
  }
  
  return {
    allowed: true,
    quota: userQuota,
  };
}

async function checkSystemCapacity(): Promise<{
  allowed: boolean;
  reason?: string;
  metrics: any;
}> {
  const systemMetrics = await getSystemMetrics();
  
  // Check active pipelines limit (8 max)
  if (systemMetrics.activePipelines >= 8) {
    return {
      allowed: false,
      reason: "System at capacity. Please try again later.",
      metrics: systemMetrics,
    };
  }
  
  // Check system health
  if (systemMetrics.systemHealth !== "healthy") {
    return {
      allowed: false,
      reason: "System is currently unhealthy. Please try again later.",
      metrics: systemMetrics,
    };
  }
  
  return {
    allowed: true,
    metrics: systemMetrics,
  };
}

async function createPipelineRecord(
  userId: string,
  youtubeUrl: string,
  fontFamily: string
) {
  const runId = generateRunId();
  
  const { data: pipeline, error } = await supabase
    .from('pipelines')
    .insert({
      run_id: runId,
      user_id: userId,
      youtube_url: youtubeUrl,
      font_family: fontFamily,
      status: 'pending',
      created_at: new Date().toISOString(),
    })
    .select('id, run_id')
    .single();
    
  if (error) {
    throw new Error(`Failed to create pipeline: ${error.message}`);
  }
  
  return {
    id: pipeline.id,
    runId: pipeline.run_id,
  };
}

async function updateUserQuota(
  userId: string,
  requestsDelta: number,
  concurrentDelta: number
) {
  // Get current values
  const { data: currentProfile, error: fetchError } = await supabase
    .from('user_profiles')
    .select('daily_requests, concurrent_jobs')
    .eq('id', userId)
    .single();
    
  if (fetchError) {
    console.error("❌ Error fetching current user quota:", fetchError);
    return;
  }
  
  // Update with incremented values
  const { error: updateError } = await supabase
    .from('user_profiles')
    .update({
      daily_requests: (currentProfile.daily_requests || 0) + requestsDelta,
      concurrent_jobs: (currentProfile.concurrent_jobs || 0) + concurrentDelta,
    })
    .eq('id', userId);
    
  if (updateError) {
    console.error("❌ Error updating user quota:", updateError);
  }
}

async function getUserQuota(userId: string) {
  const { data: userProfile, error } = await supabase
    .from('user_profiles')
    .select('daily_requests, daily_limit, concurrent_jobs, concurrent_limit, is_blocked')
    .eq('id', userId)
    .single();
    
  if (error) {
    console.error("❌ Error fetching user quota:", error);
    // Return default values if user not found
    return {
      daily_requests: 0,
      daily_limit: 50,
      concurrent_jobs: 0,
      concurrent_limit: 3,
      is_blocked: false,
    };
  }
  
  return userProfile;
}

async function getSystemMetrics() {
  try {
    // Get active pipelines count
    const { count: activePipelines, error: pipelinesError } = await supabase
      .from('pipelines')
      .select('*', { count: 'exact' })
      .in('status', ['pending', 'processing']);
      
    if (pipelinesError) {
      console.error("❌ Error fetching active pipelines:", pipelinesError);
    }
    
    // Get active renders count
    const { count: activeRenders, error: rendersError } = await supabase
      .from('render_jobs')
      .select('*', { count: 'exact' })
      .in('status', ['pending', 'processing']);
      
    if (rendersError) {
      console.error("❌ Error fetching active renders:", rendersError);
    }
    
    // Get total daily requests (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: totalDailyRequests, error: dailyError } = await supabase
      .from('pipelines')
      .select('*', { count: 'exact' })
      .gte('created_at', oneDayAgo);
      
    if (dailyError) {
      console.error("❌ Error fetching daily requests:", dailyError);
    }
    
    // Simple health check based on active pipelines
    const healthStatus = (activePipelines || 0) < 8 ? "healthy" : "degraded";
    
    return {
      activePipelines: activePipelines || 0,
      activeRenders: activeRenders || 0,
      totalDailyRequests: totalDailyRequests || 0,
      systemHealth: healthStatus,
    };
  } catch (error) {
    console.error("❌ Error fetching system metrics:", error);
    return {
      activePipelines: 0,
      activeRenders: 0,
      totalDailyRequests: 0,
      systemHealth: "unhealthy",
    };
  }
}

function generateRunId(): string {
  return `prod-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
} 