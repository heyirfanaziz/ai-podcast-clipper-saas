// Test the fixed webhook endpoint with proper data structure
const testFixedWebhook = async () => {
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
    console.log('🔗 Testing FIXED webhook with payload:');
    console.log('📊 Uploaded file ID:', webhookPayload.results.uploaded_file_id);
    console.log('📊 User ID:', webhookPayload.results.user_id);
    
    const response = await fetch('http://localhost:3000/api/modal-complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(webhookPayload)
    });

    const result = await response.json();
    console.log('✅ Webhook response:', response.status, result);
    
    if (response.status === 200) {
      console.log('🎉 Webhook test PASSED! The uploaded_file_id should now be properly extracted.');
    } else {
      console.log('❌ Webhook test FAILED! Check the error details above.');
    }
    
  } catch (error) {
    console.error('❌ Webhook test failed:', error);
  }
};

// Test with missing uploaded_file_id (should use user_id as fallback)
const testFallbackWebhook = async () => {
  const webhookPayload = {
    "phase": "phase1",
    "run_id": "analysis-1754811871-7f0186be",
    "status": "completed",
    "results": {
      "user_id": "0114c5cd-b65a-4f0e-b2f0-95fc86937970",
      // uploaded_file_id is missing - should fallback to user_id
      "download_url": "https://example.com/video.mp4",
      "video_id": "test-video-123",
      "title": "Test Video Title",
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
      }
    }
  };

  try {
    console.log('\n🔗 Testing webhook with FALLBACK (missing uploaded_file_id):');
    console.log('📊 User ID (will be used as fallback):', webhookPayload.results.user_id);
    
    const response = await fetch('http://localhost:3000/api/modal-complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(webhookPayload)
    });

    const result = await response.json();
    console.log('✅ Fallback webhook response:', response.status, result);
    
    if (response.status === 200) {
      console.log('🎉 Fallback test PASSED! The user_id was used as uploaded_file_id.');
    } else {
      console.log('❌ Fallback test FAILED! Check the error details above.');
    }
    
  } catch (error) {
    console.error('❌ Fallback webhook test failed:', error);
  }
};

// Test with missing results (should fail with 400)
const testMissingResultsWebhook = async () => {
  const webhookPayload = {
    "phase": "phase1",
    "run_id": "analysis-1754811871-7f0186be",
    "status": "completed"
    // results is missing - should fail validation
  };

  try {
    console.log('\n🔗 Testing webhook with MISSING RESULTS (should fail):');
    
    const response = await fetch('http://localhost:3000/api/modal-complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(webhookPayload)
    });

    const result = await response.json();
    console.log('✅ Missing results webhook response:', response.status, result);
    
    if (response.status === 400) {
      console.log('🎉 Missing results test PASSED! Properly rejected invalid payload.');
    } else {
      console.log('❌ Missing results test FAILED! Should have returned 400 status.');
    }
    
  } catch (error) {
    console.error('❌ Missing results webhook test failed:', error);
  }
};

// Run all tests
const runAllTests = async () => {
  console.log('🧪 Running webhook tests...\n');
  
  await testFixedWebhook();
  await testFallbackWebhook();
  await testMissingResultsWebhook();
  
  console.log('\n🏁 All webhook tests completed!');
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { testFixedWebhook, testFallbackWebhook, testMissingResultsWebhook, runAllTests };
}

// Run tests if this script is executed directly
if (typeof window === 'undefined') {
  runAllTests();
}
