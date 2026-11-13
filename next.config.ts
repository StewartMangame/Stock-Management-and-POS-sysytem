import type { NextConfig } from 'next';

const isStaging = (process.env.APP_ENV || '').toLowerCase() === 'staging';

const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com;
  frame-src 'self' https://challenges.cloudflare.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https:;
  font-src 'self' data:;
  connect-src 'self' https://challenges.cloudflare.com;
`
  .replace(/\s{2,}/g, ' ')
  .trim();

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
  serverExternalPackages: ['ws', 'bufferutil', 'utf-8-validate', '@node-rs/argon2'],
  images: {
    remotePatterns: [],
  },
  async headers() {
    const securityHeaders = [
      {
        key: 'Content-Security-Policy-Report-Only',
        value: cspHeader,
      },
      {
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains', // Without preload as requested
      },
      {
        key: 'X-Content-Type-Options',
        value: 'nosniff',
      },
      {
        key: 'X-Frame-Options',
        value: 'DENY',
      },
      {
        key: 'Referrer-Policy',
        value: 'strict-origin-when-cross-origin',
      },
      {
        key: 'Permissions-Policy',
        value: 'camera=(self)',
      },
      ...(isStaging
        ? [
            {
              key: 'X-Robots-Tag',
              value: 'noindex, nofollow',
            },
          ]
        : []),
    ];

    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
