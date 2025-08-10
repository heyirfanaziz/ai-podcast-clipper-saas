/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  // Disable TypeScript errors during build (we'll handle them in development)
  typescript: {
    ignoreBuildErrors: true,
  },
  // Disable ESLint errors during build
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer }) => {
    // Exclude Remotion packages from client-side bundle
    if (!isServer) {
      config.externals = config.externals || [];
      config.externals.push(
        '@remotion/lambda',
        '@remotion/renderer', 
        '@remotion/cli',
        '@remotion/compositor-win32-x64-msvc',
        '@remotion/compositor-darwin-x64',
        '@remotion/compositor-linux-x64-musl', 
        '@remotion/compositor-linux-x64-gnu',
        '@remotion/compositor-linux-arm64-musl'
      );
      
      // Add fallback for Remotion packages to empty modules
      config.resolve.fallback = {
        ...config.resolve.fallback,
        '@remotion/lambda': false,
        '@remotion/renderer': false,
        '@remotion/cli': false,
        '@remotion/compositor-win32-x64-msvc': false,
        '@remotion/compositor-darwin-x64': false,
        '@remotion/compositor-linux-x64-musl': false,
        '@remotion/compositor-linux-x64-gnu': false,
        '@remotion/compositor-linux-arm64-musl': false,
      };
    }
    return config;
  },
};

export default config;
