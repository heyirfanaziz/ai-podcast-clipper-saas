// Test webhook locally with Modal data structure
const testWebhook = async () => {
  const webhookPayload = {
    "phase": "phase1",
    "run_id": "analysis-1754811871-7f0186be",
    "status": "completed",
    "results": {
      "user_id": "0114c5cd-b65a-4f0e-b2f0-95fc86937970",
      "uploaded_file_id": "0114c5cd-b65a-4f0e-b2f0-95fc86937970",
      "download_url": "https://example.com/video.mp4",
      "video_id": "test-video-123",
      "title": "Test Video Title",
      "r2_base_path": "users-data/0114c5cd-b65a-4f0e-b2f0-95fc86937970/2025/08/analysis-1754811871-7f0186be",
      "uploaded_files": ["video.mp4", "captions.srt"],
      "transcript": {
        "segments": [],
        "language": "en",
        "transcription_time": 42.4
      },
      "viral_moments": [],
      "performance": {
        "download_time": 18.0,
        "transcription_time": 42.4,
        "ai_analysis_time": 57.9,
        "total_time": 123.6,
        "estimated_cost": 0.0274
      },
      "architecture": "parallel-batch-analysis-phase",
      "new_structure": true
    }
  };

  try {
    console.log('🔗 Testing webhook with payload:', JSON.stringify(webhookPayload, null, 2));
    
    const response = await fetch('http://localhost:3000/api/modal-complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(webhookPayload)
    });

    const result = await response.json();
    console.log('✅ Webhook response:', response.status, result);
    
  } catch (error) {
    console.error('❌ Webhook test failed:', error);
  }
};

// Test the webhook
testWebhook();
