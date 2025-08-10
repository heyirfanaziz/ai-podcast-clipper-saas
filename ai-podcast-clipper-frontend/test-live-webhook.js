#!/usr/bin/env node

/**
 * Test script for testing webhook directly on live domain www.auclip.com
 * This will test the actual production webhook endpoint
 */

const LIVE_WEBHOOK_URL = 'https://www.auclip.com/api/modal-complete';

// Test 1: Complete payload with uploaded_file_id
async function testCompleteWebhook() {
  console.log('\n🔗 Testing COMPLETE webhook on live domain...');
  
  const payload = {
    phase: "phase1",
    status: "completed",
    run_id: "test-live-" + Date.now(),
    results: {
      user_id: "0114c5cd-b65a-4f0e-b2f0-95fc86937970",
      uploaded_file_id: "0114c5cd-b65a-4f0e-b2f0-95fc86937970",
      download_url: "https://example.com/video.mp4",
      video_id: "test-video-live",
      title: "Test Video Title - Live Test",
      transcript: {
        segments: [],
        language: "en",
        transcription_time: 42.4
      },
      viral_moments: [],
      performance: {
        download_time: 18,
        transcription_time: 42.4,
        ai_analysis_time: 57.9,
        total_time: 123.6,
        estimated_cost: 0.0274
      }
    }
  };

  console.log('📊 Payload:', JSON.stringify(payload, null, 2));
  console.log('📊 Uploaded file ID:', payload.results.uploaded_file_id);
  console.log('📊 User ID:', payload.results.user_id);

  try {
    const response = await fetch(LIVE_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    let responseData;
    
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = { raw: responseText };
    }

    console.log(`✅ Live webhook response: ${response.status}`, responseData);
    
    if (response.ok) {
      console.log('🎉 Live webhook test PASSED! Webhook processed successfully.');
      return true;
    } else {
      console.log('❌ Live webhook test FAILED! Check the error details above.');
      return false;
    }
  } catch (error) {
    console.error('❌ Live webhook test failed:', error.message);
    return false;
  }
}

// Test 2: Missing uploaded_file_id (should use user_id as fallback)
async function testFallbackWebhook() {
  console.log('\n🔗 Testing FALLBACK webhook on live domain (missing uploaded_file_id)...');
  
  const payload = {
    phase: "phase1",
    status: "completed",
    run_id: "test-fallback-" + Date.now(),
    results: {
      user_id: "0114c5cd-b65a-4f0e-b2f0-95fc86937970",
      // uploaded_file_id intentionally missing
      download_url: "https://example.com/video.mp4",
      video_id: "test-video-fallback",
      title: "Test Video Title - Fallback Test",
      transcript: {
        segments: [],
        language: "en",
        transcription_time: 42.4
      }
    }
  };

  console.log('📊 Payload (missing uploaded_file_id):', JSON.stringify(payload, null, 2));
  console.log('📊 User ID (will be used as fallback):', payload.results.user_id);

  try {
    const response = await fetch(LIVE_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    let responseData;
    
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = { raw: responseText };
    }

    console.log(`✅ Fallback webhook response: ${response.status}`, responseData);
    
    if (response.ok) {
      console.log('🎉 Fallback webhook test PASSED! Webhook used user_id as fallback.');
      return true;
    } else {
      console.log('❌ Fallback webhook test FAILED! Check the error details above.');
      return false;
    }
  } catch (error) {
    console.error('❌ Fallback webhook test failed:', error.message);
    return false;
  }
}

// Test 3: Missing results (should return 400 error)
async function testMissingResultsWebhook() {
  console.log('\n🔗 Testing MISSING RESULTS webhook on live domain (should fail)...');
  
  const payload = {
    phase: "phase1",
    status: "completed",
    run_id: "test-missing-results-" + Date.now()
    // results intentionally missing
  };

  console.log('📊 Payload (missing results):', JSON.stringify(payload, null, 2));

  try {
    const response = await fetch(LIVE_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    let responseData;
    
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = { raw: responseText };
    }

    console.log(`✅ Missing results webhook response: ${response.status}`, responseData);
    
    if (response.status === 400) {
      console.log('🎉 Missing results test PASSED! Properly rejected invalid payload.');
      return true;
    } else {
      console.log('❌ Missing results test FAILED! Expected 400 error but got', response.status);
      return false;
    }
  } catch (error) {
    console.error('❌ Missing results webhook test failed:', error.message);
    return false;
  }
}

// Test 4: Phase 2 webhook
async function testPhase2Webhook() {
  console.log('\n🔗 Testing PHASE 2 webhook on live domain...');
  
  const payload = {
    phase: "phase2",
    status: "completed",
    run_id: "test-phase2-" + Date.now(),
    batch_index: 0,
    results: {
      user_id: "0114c5cd-b65a-4f0e-b2f0-95fc86937970",
      clips_processed: 5,
      total_clips: 10,
      performance: {
        processing_time: 45.2,
        estimated_cost: 0.015
      }
    }
  };

  console.log('📊 Phase 2 payload:', JSON.stringify(payload, null, 2));

  try {
    const response = await fetch(LIVE_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    let responseData;
    
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = { raw: responseText };
    }

    console.log(`✅ Phase 2 webhook response: ${response.status}`, responseData);
    
    if (response.ok) {
      console.log('🎉 Phase 2 webhook test PASSED!');
      return true;
    } else {
      console.log('❌ Phase 2 webhook test FAILED! Check the error details above.');
      return false;
    }
  } catch (error) {
    console.error('❌ Phase 2 webhook test failed:', error.message);
    return false;
  }
}

// Run all tests
async function runAllLiveTests() {
  console.log('🧪 Running LIVE webhook tests on www.auclip.com...\n');
  
  const results = [];
  
  results.push(await testCompleteWebhook());
  results.push(await testFallbackWebhook());
  results.push(await testMissingResultsWebhook());
  results.push(await testPhase2Webhook());
  
  console.log('\n🏁 All live webhook tests completed!');
  console.log(`📊 Results: ${results.filter(r => r).length}/${results.length} tests passed`);
  
  if (results.every(r => r)) {
    console.log('🎉 All tests PASSED! The webhook is working correctly on the live domain.');
  } else {
    console.log('⚠️  Some tests FAILED. Check the details above for issues.');
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllLiveTests().catch(console.error);
}

export { runAllLiveTests };
