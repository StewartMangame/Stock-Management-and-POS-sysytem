import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '4mb',
    },
  },
  // Keep native Node.js modules external — webpack must not bundle them.
  // bufferutil / utf-8-validate: native ws addons; bundling them breaks WebSocket connections.
  // @node-rs/argon2: uses WASM/native bindings incompatible with the edge/browser bundle.
  serverExternalPackages: ['ws', 'bufferutil', 'utf-8-validate', '@node-rs/argon2'],
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;
