import { serve } from "inngest/next";
import { inngest } from "../../../inngest/client";
import { 
  rapidApiOrchestrator
} from "../../../inngest/parallel-batch-functions";
import { monitorRemotionProgress } from "../../../inngest/render-completion-handler";
import { handleRenderStarted, handleRenderCompleted } from "../../../inngest/remotion-render-handler";
import {
  phase1OrchestratorEventDriven,
  phase2BatchProcessorEventDriven,
  phase3RemotionProcessor
} from "../../../inngest/event-driven-functions";

// Register all functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    // RapidAPI download orchestrator
    rapidApiOrchestrator,
    
    // Event-Driven Orchestration Functions
    phase1OrchestratorEventDriven,
    phase2BatchProcessorEventDriven,
    phase3RemotionProcessor,
    
    // Support Functions
    monitorRemotionProgress,
    handleRenderStarted,
    handleRenderCompleted
  ],
});
