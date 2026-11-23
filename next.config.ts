import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  devIndicators: false,
  serverExternalPackages: ['pg', 'express'],
};

export default nextConfig;
