import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@sana-guard/sdk'],
  serverExternalPackages: ['near-api-js'],
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      encoding: false,
    };
    return config;
  },
};

export default nextConfig;
