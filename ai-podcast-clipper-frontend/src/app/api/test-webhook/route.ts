import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phase, run_id, status, results, batch_index } = body;

    console.log(`🔗 Test webhook received: ${phase} - ${status} - ${run_id}`);
    console.log(`📊 Test webhook payload:`, JSON.stringify(body, null, 2));

    // Test the data extraction logic without Inngest
    if (phase === "phase1" && status === "completed") {
      // Ensure results exists and extract uploaded_file_id safely
      if (!results) {
        console.error(`❌ Missing results in phase1 webhook for run_id: ${run_id}`);
        return NextResponse.json(
          { error: 'Missing results in webhook payload' },
          { status: 400 }
        );
      }

      // Extract uploaded_file_id from results, with fallback to user_id if needed
      const uploaded_file_id = results.uploaded_file_id || results.user_id;
      
      if (!uploaded_file_id) {
        console.error(`❌ Missing uploaded_file_id in phase1 webhook results for run_id: ${run_id}`);
        return NextResponse.json(
          { error: 'Missing uploaded_file_id in webhook results' },
          { status: 400 }
        );
      }

      const eventData = {
        run_id,
        status,
        results,
        uploaded_file_id  // This is now guaranteed to exist
      };
      
      console.log(`🚀 Test webhook data extraction successful`);
      console.log(`📤 Extracted event data:`, JSON.stringify(eventData, null, 2));
      
      return NextResponse.json({ 
        success: true, 
        message: 'Data extraction test passed',
        extracted_data: eventData
      });
    }
    
    else if (phase === "phase2" && status === "completed") {
      // Ensure results exists for phase2
      if (!results) {
        console.error(`❌ Missing results in phase2 webhook for run_id: ${run_id}`);
        return NextResponse.json(
          { error: 'Missing results in webhook payload' },
          { status: 400 }
        );
      }

      return NextResponse.json({ 
        success: true, 
        message: 'Phase2 data extraction test passed',
        extracted_data: { run_id, batch_index, status, results }
      });
    }
    
    else {
      console.log(`⚠️ Unknown phase or status: ${phase} - ${status}`);
      return NextResponse.json({ 
        success: false, 
        message: `Unknown phase or status: ${phase} - ${status}` 
      });
    }

  } catch (error) {
    console.error('❌ Test webhook error:', error);
    return NextResponse.json(
      { error: 'Test webhook processing failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  return new NextResponse("Test webhook endpoint is working", { status: 200 });
} 