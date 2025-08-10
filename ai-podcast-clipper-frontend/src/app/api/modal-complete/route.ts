import { NextRequest, NextResponse } from 'next/server';
import { inngest } from '../../../inngest/client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phase, run_id, status, results, batch_index } = body;

    console.log(`🔗 Modal webhook received: ${phase} - ${status} - ${run_id}`);
    console.log(`📊 Webhook payload:`, JSON.stringify(body, null, 2));

    // Forward to Inngest based on phase
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

      const inngestEventData = {
        run_id,
        status,
        results,
        uploaded_file_id  // This is now guaranteed to exist
      };
      
      console.log(`🚀 Sending to Inngest: modal.phase1.completed`);
      console.log(`📤 Inngest event data:`, JSON.stringify(inngestEventData, null, 2));

      try {
        const inngestResponse = await inngest.send({
          name: "modal.phase1.completed",
          data: inngestEventData
        });
        
        console.log(`✅ Forwarded phase1 completion to Inngest:`, inngestResponse);
      } catch (inngestError) {
        console.error(`❌ Inngest send failed:`, inngestError);
        throw inngestError;
      }
      
      return NextResponse.json({ success: true });
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

      await inngest.send({
        name: "modal.phase2.completed",
        data: {
          run_id,
          batch_index,
          status,
          results
        }
      });
      console.log(`✅ Forwarded phase2 completion to Inngest`);
    }
    
    else {
      console.log(`⚠️ Unknown phase or status: ${phase} - ${status}`);
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('❌ Modal webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
} 