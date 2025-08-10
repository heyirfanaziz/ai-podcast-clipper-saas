import { NextResponse } from 'next/server';
import { createSupabaseAdmin } from '~/lib/supabase-server';

export async function GET() {
  try {
    const supabase = createSupabaseAdmin();
    
    // Check recent render jobs
    const { data: renderJobs, error: renderError } = await supabase
      .from('render_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (renderError) {
      console.error('Error fetching render jobs:', renderError);
      return NextResponse.json({ error: 'Failed to fetch render jobs' }, { status: 500 });
    }
    
    // Check recent clips
    const { data: clips, error: clipsError } = await supabase
      .from('generated_clips')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (clipsError) {
      console.error('Error fetching clips:', clipsError);
      return NextResponse.json({ error: 'Failed to fetch clips' }, { status: 500 });
    }
    
    // Check recent pipelines
    const { data: pipelines, error: pipelinesError } = await supabase
      .from('pipelines')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (pipelinesError) {
      console.error('Error fetching pipelines:', pipelinesError);
      return NextResponse.json({ error: 'Failed to fetch pipelines' }, { status: 500 });
    }
    
    return NextResponse.json({
      success: true,
      renderJobs: renderJobs || [],
      clips: clips || [],
      pipelines: pipelines || [],
      summary: {
        totalRenderJobs: renderJobs?.length || 0,
        totalClips: clips?.length || 0,
        totalPipelines: pipelines?.length || 0,
        latestPipeline: pipelines?.[0]?.status || 'none',
        latestRenderJob: renderJobs?.[0]?.status || 'none'
      }
    });
    
  } catch (error) {
    console.error('Test remotion error:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 