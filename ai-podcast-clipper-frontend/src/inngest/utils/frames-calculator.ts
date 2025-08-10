/**
 * Calculate optimal frames per lambda considering concurrency limits
 * This ensures we don't exceed the Lambda concurrency limit of 10
 */

interface FrameCalculationResult {
  framesPerLambda: number;
  estimatedLambdaCount: number;
  concurrencyRespected: boolean;
  reasoning: string;
}

export function calculateOptimalFramesPerLambda(
  durationSeconds: number,
  fps: number = 30,
  maxConcurrency: number = 10
): FrameCalculationResult {
  const totalFrames = Math.ceil(durationSeconds * fps);
  
  // Start with the current logic as baseline
  let baseFramesPerLambda: number;
  
  if (durationSeconds <= 30) {
    // Short clips: Try single Lambda for maximum speed
    baseFramesPerLambda = totalFrames;
  } else if (durationSeconds <= 60) {
    // Medium clips: ~3-4 Lambda functions
    baseFramesPerLambda = Math.max(200, Math.ceil(totalFrames / 4));
  } else {
    // Long clips: ~5-6 Lambda functions
    baseFramesPerLambda = Math.max(300, Math.ceil(totalFrames / 6));
  }
  
  let estimatedLambdaCount = Math.ceil(totalFrames / baseFramesPerLambda);
  
  // Check if we exceed concurrency limit
  if (estimatedLambdaCount > maxConcurrency) {
    // Recalculate to respect concurrency limit
    const adjustedFramesPerLambda = Math.ceil(totalFrames / maxConcurrency);
    
    return {
      framesPerLambda: adjustedFramesPerLambda,
      estimatedLambdaCount: maxConcurrency,
      concurrencyRespected: true,
      reasoning: `Adjusted from ${estimatedLambdaCount} to ${maxConcurrency} lambdas to respect concurrency limit. Increased frames per lambda from ${baseFramesPerLambda} to ${adjustedFramesPerLambda}.`
    };
  }
  
  // Original calculation is within limits
  return {
    framesPerLambda: baseFramesPerLambda,
    estimatedLambdaCount,
    concurrencyRespected: true,
    reasoning: `Original calculation within limits: ${estimatedLambdaCount} lambdas with ${baseFramesPerLambda} frames each.`
  };
}

/**
 * Legacy function for backward compatibility
 */
export function calculateFramesPerLambda(
  durationSeconds: number,
  fps: number = 30
): number {
  const result = calculateOptimalFramesPerLambda(durationSeconds, fps);
  return result.framesPerLambda;
} 