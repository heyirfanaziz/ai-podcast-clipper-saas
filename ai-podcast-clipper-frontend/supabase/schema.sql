-- ===============================================
-- AI PODCAST CLIPPER - SUPABASE DATABASE SCHEMA
-- ===============================================

-- Create user_profiles table to extend Supabase auth.users
CREATE TABLE user_profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    
    -- Credits and billing
    credits INTEGER DEFAULT 100,
    total_credits_used INTEGER DEFAULT 0,
    stripe_customer_id TEXT,
    
    -- User quotas
    daily_requests INTEGER DEFAULT 0,
    daily_limit INTEGER DEFAULT 20,
    last_quota_reset TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    concurrent_jobs INTEGER DEFAULT 0,
    concurrent_limit INTEGER DEFAULT 3,
    
    -- Status
    is_blocked BOOLEAN DEFAULT FALSE,
    block_reason TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create pipelines table for tracking processing jobs
CREATE TABLE pipelines (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id TEXT UNIQUE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    status TEXT DEFAULT 'pending',
    
    -- Input data
    youtube_url TEXT NOT NULL,
    font_family TEXT DEFAULT 'anton',
    
    -- Phase tracking
    phase1_started_at TIMESTAMP WITH TIME ZONE,
    phase1_completed_at TIMESTAMP WITH TIME ZONE,
    phase2_started_at TIMESTAMP WITH TIME ZONE,
    phase2_completed_at TIMESTAMP WITH TIME ZONE,
    phase3_started_at TIMESTAMP WITH TIME ZONE,
    phase3_completed_at TIMESTAMP WITH TIME ZONE,
    
    -- Metrics
    download_time FLOAT,
    transcription_time FLOAT,
    ai_analysis_time FLOAT,
    clip_processing_time FLOAT,
    remotion_render_time FLOAT,
    total_pipeline_time FLOAT,
    
    -- Results
    total_clips INTEGER DEFAULT 0,
    successful_clips INTEGER DEFAULT 0,
    failed_clips INTEGER DEFAULT 0,
    
    -- Cost tracking
    estimated_cost FLOAT DEFAULT 0,
    actual_cost FLOAT,
    gpu_minutes_used FLOAT DEFAULT 0,
    
    -- Error tracking
    error_message TEXT,
    error_phase TEXT,
    retry_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create generated_clips table
CREATE TABLE generated_clips (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    clip_index INTEGER NOT NULL,
    run_id TEXT NOT NULL,
    pipeline_id UUID REFERENCES pipelines(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    
    -- Clip metadata
    title TEXT NOT NULL,
    start_time FLOAT NOT NULL,
    end_time FLOAT NOT NULL,
    duration FLOAT NOT NULL,
    viral_score INTEGER NOT NULL,
    hook_type TEXT NOT NULL,
    
    -- Content
    question_context TEXT,
    answer_summary TEXT,
    ending_quality TEXT,
    duration_reason TEXT,
    
    -- File locations
    s3_video_url TEXT,
    s3_captions_url TEXT,
    r2_final_url TEXT,
    
    -- Processing status
    status TEXT DEFAULT 'pending',
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(run_id, clip_index)
);

-- Create render_jobs table
CREATE TABLE render_jobs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    render_id TEXT UNIQUE NOT NULL,
    clip_id UUID REFERENCES generated_clips(id) ON DELETE CASCADE NOT NULL,
    pipeline_id UUID REFERENCES pipelines(id) ON DELETE CASCADE NOT NULL,
    
    -- Remotion details
    remotion_job_id TEXT,
    remotion_status TEXT,
    remotion_progress FLOAT DEFAULT 0,
    
    -- Lambda details
    lambda_request_id TEXT,
    lambda_function_name TEXT,
    lambda_region TEXT DEFAULT 'us-east-1',
    
    -- File details
    input_video_url TEXT NOT NULL,
    input_captions_url TEXT NOT NULL,
    output_s3_key TEXT,
    output_r2_url TEXT,
    
    -- Performance
    render_started_at TIMESTAMP WITH TIME ZONE,
    render_completed_at TIMESTAMP WITH TIME ZONE,
    render_duration FLOAT,
    
    -- Cost tracking
    lambda_minutes_used FLOAT,
    estimated_cost FLOAT DEFAULT 0,
    
    -- Error handling
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create system_metrics table
CREATE TABLE system_metrics (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Capacity metrics
    active_pipelines INTEGER DEFAULT 0,
    active_renders INTEGER DEFAULT 0,
    total_daily_requests INTEGER DEFAULT 0,
    
    -- Performance metrics
    avg_pipeline_time FLOAT,
    avg_cost_per_pipeline FLOAT,
    success_rate FLOAT,
    
    -- Resource usage
    modal_containers_used INTEGER DEFAULT 0,
    gpu_minutes_used FLOAT DEFAULT 0,
    remotion_minutes_used FLOAT DEFAULT 0,
    
    -- Health status
    modal_health TEXT DEFAULT 'unknown',
    remotion_health TEXT DEFAULT 'unknown',
    system_health TEXT DEFAULT 'unknown',
    
    -- Timestamp
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ===============================================
-- INDEXES FOR PERFORMANCE
-- ===============================================

-- User profiles indexes
CREATE INDEX idx_user_profiles_email ON user_profiles(email);
CREATE INDEX idx_user_profiles_created_at ON user_profiles(created_at);

-- Pipelines indexes
CREATE INDEX idx_pipelines_user_id ON pipelines(user_id);
CREATE INDEX idx_pipelines_status ON pipelines(status);
CREATE INDEX idx_pipelines_run_id ON pipelines(run_id);
CREATE INDEX idx_pipelines_created_at ON pipelines(created_at);

-- Generated clips indexes
CREATE INDEX idx_generated_clips_user_id ON generated_clips(user_id);
CREATE INDEX idx_generated_clips_pipeline_id ON generated_clips(pipeline_id);
CREATE INDEX idx_generated_clips_status ON generated_clips(status);
CREATE INDEX idx_generated_clips_created_at ON generated_clips(created_at);

-- Render jobs indexes
CREATE INDEX idx_render_jobs_render_id ON render_jobs(render_id);
CREATE INDEX idx_render_jobs_remotion_status ON render_jobs(remotion_status);
CREATE INDEX idx_render_jobs_created_at ON render_jobs(created_at);
CREATE INDEX idx_render_jobs_clip_id ON render_jobs(clip_id);

-- System metrics indexes
CREATE INDEX idx_system_metrics_created_at ON system_metrics(created_at);

-- ===============================================
-- ROW LEVEL SECURITY (RLS)
-- ===============================================

-- Enable RLS on all tables
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE render_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_metrics ENABLE ROW LEVEL SECURITY;

-- User profiles policies
CREATE POLICY "Users can view their own profile" ON user_profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON user_profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" ON user_profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Pipelines policies
CREATE POLICY "Users can view their own pipelines" ON pipelines
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own pipelines" ON pipelines
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own pipelines" ON pipelines
    FOR UPDATE USING (auth.uid() = user_id);

-- Generated clips policies
CREATE POLICY "Users can view their own clips" ON generated_clips
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own clips" ON generated_clips
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own clips" ON generated_clips
    FOR UPDATE USING (auth.uid() = user_id);

-- Render jobs policies
CREATE POLICY "Users can view their own render jobs" ON render_jobs
    FOR SELECT USING (auth.uid() IN (
        SELECT user_id FROM pipelines WHERE id = pipeline_id
    ));

CREATE POLICY "Users can insert their own render jobs" ON render_jobs
    FOR INSERT WITH CHECK (auth.uid() IN (
        SELECT user_id FROM pipelines WHERE id = pipeline_id
    ));

CREATE POLICY "Users can update their own render jobs" ON render_jobs
    FOR UPDATE USING (auth.uid() IN (
        SELECT user_id FROM pipelines WHERE id = pipeline_id
    ));

-- System metrics policies (admin only - for now allow all authenticated users to read)
CREATE POLICY "Authenticated users can view system metrics" ON system_metrics
    FOR SELECT USING (auth.role() = 'authenticated');

-- ===============================================
-- FUNCTIONS AND TRIGGERS
-- ===============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to automatically update updated_at
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pipelines_updated_at BEFORE UPDATE ON pipelines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_generated_clips_updated_at BEFORE UPDATE ON generated_clips
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_render_jobs_updated_at BEFORE UPDATE ON render_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (
        id, 
        email, 
        full_name, 
        avatar_url,
        credits,
        daily_requests,
        daily_limit,
        concurrent_jobs,
        concurrent_limit,
        is_blocked,
        stripe_customer_id
    )
    VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'avatar_url',
        100,  -- Default 100 credits
        0,    -- Start with 0 daily requests
        50,   -- Default daily limit
        0,    -- Start with 0 concurrent jobs
        3,    -- Default concurrent limit
        FALSE, -- Not blocked
        NULL  -- No Stripe customer ID yet
    );
    RETURN NEW;
END;
$$ language 'plpgsql' SECURITY DEFINER;

-- Trigger to create user profile on signup
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user(); 