import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@interviehire/shared'],
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // The candidate room moved from /interview to /interviewcandidateroom. Keep the
  // old paths working (emailed invite links, bookmarks, in-flight local sessions)
  // by redirecting them to the new route. The engine API namespace (/api/interview)
  // is unaffected — these are page routes only.
  async redirects() {
    return [
      { source: '/interview', destination: '/interviewcandidateroom', permanent: false },
      { source: '/interview/:path*', destination: '/interviewcandidateroom/:path*', permanent: false },
    ];
  },
};

export default nextConfig;
