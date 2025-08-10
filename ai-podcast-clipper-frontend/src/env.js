import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    AWS_ACCESS_KEY_ID: z.string(),
    AWS_SECRET_ACCESS_KEY: z.string(),
    AWS_REGION: z.string(),
    S3_BUCKET_NAME: z.string(),
    PROCESS_VIDEO_ENDPOINT: z.string(),
    PROCESS_YOUTUBE_ENDPOINT: z.string().optional(),
    PROCESS_VIDEO_ENDPOINT_AUTH: z.string(),
    STRIPE_SECRET_KEY: z.string(),
    STRIPE_SMALL_CREDIT_PACK: z.string(),
    STRIPE_MEDIUM_CREDIT_PACK: z.string(),
    STRIPE_LARGE_CREDIT_PACK: z.string(),
    BASE_URL: z.string(),
    STRIPE_WEBHOOK_SECRET: z.string(),
    // Inngest Configuration
    INNGEST_EVENT_KEY: z.string().optional(),
    INNGEST_SIGNING_KEY: z.string().optional(),
    INNGEST_SERVE_URL: z.string().url().optional(),
    // Cloudflare R2 configuration (optional - fallback to S3 if not provided)
    CLOUDFLARE_R2_ACCESS_KEY_ID: z.string().optional(),
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.string().optional(),
    CLOUDFLARE_R2_ACCOUNT_ID: z.string().optional(),
    CLOUDFLARE_R2_BUCKET_NAME: z.string().optional(),
    CLOUDFLARE_R2_ENDPOINT: z.string().optional(),
    
    // Production Pipeline Configuration - MADE OPTIONAL
    MODAL_ENDPOINT: z.string().url().optional(),
    MODAL_SYSTEM_STATUS_ENDPOINT: z.string().url().optional(),
    CLIPPER_SECRET_KEY: z.string().optional(),
    RAPIDAPI_KEY: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    
    // Remotion Configuration (Direct Lambda) - MADE OPTIONAL
    REMOTION_AWS_ACCESS_KEY_ID: z.string().optional(),
    REMOTION_AWS_SECRET_ACCESS_KEY: z.string().optional(),
    REMOTION_LAMBDA_REGION: z.string().optional(),
    REMOTION_LAMBDA_FUNCTION_NAME: z.string().optional(),
    AWS_ACCOUNT_ID: z.string().optional(),
    
    // System Configuration
    SYSTEM_MAX_CONCURRENT_PIPELINES: z.string().default("8"),
    SYSTEM_DAILY_REQUEST_LIMIT: z.string().default("1000"),
    USER_DAILY_REQUEST_LIMIT: z.string().default("20"),
    USER_CONCURRENT_LIMIT: z.string().default("3"),
    
    // Supabase Configuration - MADE OPTIONAL
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // NEXT_PUBLIC_CLIENTVAR: z.string(),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string(),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    AUTH_SECRET: process.env.AUTH_SECRET,
    NODE_ENV: process.env.NODE_ENV,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_REGION: process.env.AWS_REGION,
    S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
    PROCESS_VIDEO_ENDPOINT: process.env.PROCESS_VIDEO_ENDPOINT,
    PROCESS_YOUTUBE_ENDPOINT: process.env.PROCESS_YOUTUBE_ENDPOINT,
    PROCESS_VIDEO_ENDPOINT_AUTH: process.env.PROCESS_VIDEO_ENDPOINT_AUTH,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_SMALL_CREDIT_PACK: process.env.STRIPE_SMALL_CREDIT_PACK,
    STRIPE_MEDIUM_CREDIT_PACK: process.env.STRIPE_MEDIUM_CREDIT_PACK,
    STRIPE_LARGE_CREDIT_PACK: process.env.STRIPE_LARGE_CREDIT_PACK,
    BASE_URL: process.env.BASE_URL,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    // Cloudflare R2 configuration
    CLOUDFLARE_R2_ACCESS_KEY_ID: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    CLOUDFLARE_R2_ACCOUNT_ID: process.env.CLOUDFLARE_R2_ACCOUNT_ID,
    CLOUDFLARE_R2_BUCKET_NAME: process.env.CLOUDFLARE_R2_BUCKET_NAME,
    CLOUDFLARE_R2_ENDPOINT: process.env.CLOUDFLARE_R2_ENDPOINT,
    
    // Production Pipeline Configuration
    MODAL_ENDPOINT: process.env.MODAL_ENDPOINT,
    MODAL_SYSTEM_STATUS_ENDPOINT: process.env.MODAL_SYSTEM_STATUS_ENDPOINT,
    CLIPPER_SECRET_KEY: process.env.CLIPPER_SECRET_KEY,
    RAPIDAPI_KEY: process.env.RAPIDAPI_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    
    // Remotion Configuration (Direct Lambda)
    REMOTION_AWS_ACCESS_KEY_ID: process.env.REMOTION_AWS_ACCESS_KEY_ID,
    REMOTION_AWS_SECRET_ACCESS_KEY: process.env.REMOTION_AWS_SECRET_ACCESS_KEY,
    REMOTION_LAMBDA_REGION: process.env.REMOTION_LAMBDA_REGION,
    REMOTION_LAMBDA_FUNCTION_NAME: process.env.REMOTION_LAMBDA_FUNCTION_NAME,
    AWS_ACCOUNT_ID: process.env.AWS_ACCOUNT_ID,
    
    // System Configuration
    SYSTEM_MAX_CONCURRENT_PIPELINES: process.env.SYSTEM_MAX_CONCURRENT_PIPELINES,
    SYSTEM_DAILY_REQUEST_LIMIT: process.env.SYSTEM_DAILY_REQUEST_LIMIT,
    USER_DAILY_REQUEST_LIMIT: process.env.USER_DAILY_REQUEST_LIMIT,
    USER_CONCURRENT_LIMIT: process.env.USER_CONCURRENT_LIMIT,
    
    // Supabase Configuration
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    // Inngest Configuration
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
    INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,
    INNGEST_SERVE_URL: process.env.INNGEST_SERVE_URL,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
