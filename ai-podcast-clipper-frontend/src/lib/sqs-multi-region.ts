import { SQSClient, SendMessageCommand, GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import { env } from "~/env";

// 10 AWS regions for maximum throughput (10 concurrency × 10 regions = 100 concurrent renders)
export const REMOTION_REGIONS = [
  'us-east-1',      // N. Virginia
  'us-west-2',      // Oregon  
  'eu-west-1',      // Ireland
  'ap-southeast-1', // Singapore
  'ap-southeast-2', // Sydney
  'eu-central-1',   // Frankfurt
  'ca-central-1',   // Canada
  'ap-northeast-1', // Tokyo
  'ap-northeast-2', // Seoul
  'sa-east-1'       // São Paulo
] as const;

export type RemotionRegion = typeof REMOTION_REGIONS[number];

// SQS queue configuration for each region
export const QUEUE_CONFIG = {
  queueName: 'remotion-render-queue',
  visibilityTimeoutSeconds: 900, // 15 minutes (max Lambda timeout)
  messageRetentionPeriod: 1209600, // 14 days
  maxReceiveCount: 3, // Retry 3 times before sending to DLQ
  deadLetterQueueName: 'remotion-render-dlq'
} as const;

// SQS clients for each region
const sqsClients = new Map<RemotionRegion, SQSClient>();

// Initialize SQS clients for all regions
export function initializeSQSClients() {
  REMOTION_REGIONS.forEach(region => {
    if (!sqsClients.has(region)) {
      sqsClients.set(region, new SQSClient({
        region,
        credentials: {
          accessKeyId: env.REMOTION_AWS_ACCESS_KEY_ID,
          secretAccessKey: env.REMOTION_AWS_SECRET_ACCESS_KEY,
        }
      }));
    }
  });
}

// Get SQS client for a specific region
export function getSQSClient(region: RemotionRegion): SQSClient {
  const client = sqsClients.get(region);
  if (!client) {
    throw new Error(`SQS client not initialized for region: ${region}`);
  }
  return client;
}

// Generate queue URL for a specific region
export function getQueueUrl(region: RemotionRegion): string {
  return `https://sqs.${region}.amazonaws.com/${env.AWS_ACCOUNT_ID}/${QUEUE_CONFIG.queueName}`;
}

// Generate dead letter queue URL for a specific region  
export function getDLQUrl(region: RemotionRegion): string {
  return `https://sqs.${region}.amazonaws.com/${env.AWS_ACCOUNT_ID}/${QUEUE_CONFIG.deadLetterQueueName}`;
}

// Clip render message structure
export interface ClipRenderMessage {
  clipId: string;
  pipelineId: string;
  userId: string;
  clip: {
    id: string;
    title: string;
    duration: number;
    s3_video_url: string;
    s3_captions_url: string;
    clip_index: number;
    viral_score: number;
    [key: string]: any;
  };
  region: RemotionRegion;
  attempt: number;
  timestamp: number;
}

// Send clip to SQS queue in specific region
export async function sendClipToSQS(
  region: RemotionRegion,
  message: Omit<ClipRenderMessage, 'region' | 'attempt' | 'timestamp'>
): Promise<{ messageId: string; region: RemotionRegion }> {
  const client = getSQSClient(region);
  const queueUrl = getQueueUrl(region);
  
  const fullMessage: ClipRenderMessage = {
    ...message,
    region,
    attempt: 1,
    timestamp: Date.now()
  };

  try {
    const command = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(fullMessage),
      MessageAttributes: {
        clipId: {
          DataType: 'String',
          StringValue: message.clipId
        },
        pipelineId: {
          DataType: 'String', 
          StringValue: message.pipelineId
        },
        userId: {
          DataType: 'String',
          StringValue: message.userId
        },
        region: {
          DataType: 'String',
          StringValue: region
        },
        viralScore: {
          DataType: 'Number',
          StringValue: message.clip.viral_score.toString()
        }
      }
    });

    const response = await client.send(command);
    
    if (!response.MessageId) {
      throw new Error(`Failed to get MessageId from SQS response`);
    }
    
    console.log(`✅ Clip ${message.clipId} sent to SQS in ${region}`, {
      messageId: response.MessageId,
      queueUrl
    });

    return {
      messageId: response.MessageId,
      region
    };
  } catch (error) {
    console.error(`❌ Failed to send clip ${message.clipId} to SQS in ${region}:`, error);
    throw error;
  }
}

// Load balance clips across regions using round-robin with viral score prioritization
export function distributeClipsAcrossRegions(clips: any[]): Array<{ clip: any; region: RemotionRegion }> {
  // Sort clips by viral score (descending) for priority processing
  const sortedClips = [...clips].sort((a, b) => (b.viral_score || 0) - (a.viral_score || 0));
  
  return sortedClips.map((clip, index) => ({
    clip,
    region: REMOTION_REGIONS[index % REMOTION_REGIONS.length] as RemotionRegion
  }));
}

// Send multiple clips to SQS across regions
export async function sendClipBatchToSQS(
  clips: any[],
  pipelineId: string,
  userId: string
): Promise<Array<{ clipId: string; messageId: string; region: RemotionRegion; status: 'success' | 'failed'; error?: string }>> {
  // Initialize SQS clients if not already done
  initializeSQSClients();
  
  // Distribute clips across regions
  const distribution = distributeClipsAcrossRegions(clips);
  
  console.log(`🌍 Distributing ${clips.length} clips across ${REMOTION_REGIONS.length} regions`);
  
  // Send clips to their assigned regions in parallel
  const results = await Promise.allSettled(
    distribution.map(async ({ clip, region }) => {
      try {
        const result = await sendClipToSQS(region, {
          clipId: clip.id,
          pipelineId,
          userId,
          clip
        });
        
        return {
          clipId: clip.id,
          messageId: result.messageId,
          region: result.region,
          status: 'success' as const
        };
      } catch (error) {
        return {
          clipId: clip.id,
          messageId: '',
          region,
          status: 'failed' as const,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    })
  );

  // Process results
  const processedResults = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      const distributionItem = distribution[index];
      if (!distributionItem) {
        throw new Error(`Distribution item at index ${index} is undefined`);
      }
      return {
        clipId: distributionItem.clip.id,
        messageId: '',
        region: distributionItem.region,
        status: 'failed' as const,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason)
      };
    }
  });

  // Log summary
  const successful = processedResults.filter(r => r.status === 'success').length;
  const failed = processedResults.filter(r => r.status === 'failed').length;
  
  console.log(`📊 SQS Distribution Summary: ${successful} successful, ${failed} failed`);
  
  if (failed > 0) {
    console.error(`❌ Failed clips:`, processedResults.filter(r => r.status === 'failed'));
  }

  return processedResults;
}

// Check queue health across all regions
export async function checkQueueHealth(): Promise<Record<RemotionRegion, { available: boolean; approximateMessages: number; error?: string }>> {
  initializeSQSClients();
  
  const healthChecks = await Promise.allSettled(
    REMOTION_REGIONS.map(async (region) => {
      try {
        const client = getSQSClient(region);
        const queueUrl = getQueueUrl(region);
        
        const command = new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
        });
        
        const response = await client.send(command);
        const approximateMessages = parseInt(response.Attributes?.ApproximateNumberOfMessages || '0');
        
        return {
          region,
          available: true,
          approximateMessages
        };
      } catch (error) {
        return {
          region,
          available: false,
          approximateMessages: 0,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    })
  );

  const healthStatus: Record<RemotionRegion, { available: boolean; approximateMessages: number; error?: string }> = {} as any;
  
  healthChecks.forEach((result, index) => {
    const region = REMOTION_REGIONS[index];
    if (!region) return; // Skip if region is undefined
    
    if (result.status === 'fulfilled') {
      healthStatus[region] = {
        available: result.value.available,
        approximateMessages: result.value.approximateMessages,
        error: result.value.error
      };
    } else {
      healthStatus[region] = {
        available: false,
        approximateMessages: 0,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason)
      };
    }
  });

  return healthStatus;
} 