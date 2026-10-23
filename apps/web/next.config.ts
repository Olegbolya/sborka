import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  rewrites() {
    const apiPort = process.env.API_PORT ?? '3100';
    const apiHost = process.env.API_HOST ?? '127.0.0.1';
    return Promise.resolve([
      {
        source: '/api/:path*',
        destination: `http://${apiHost}:${apiPort}/api/:path*`,
      },
    ]);
  },
};

export default config;
