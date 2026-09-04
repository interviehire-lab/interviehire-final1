/** @type {import('next').NextConfig} */

// When BACKEND_ORIGIN is set (e.g. the Render URL in Vercel), proxy the FastAPI
// backend paths through this app's own origin. This keeps the auth cookie
// first-party (the browser talks only to the dashboard domain), so cross-site
// SameSite=Lax cookies work without any backend change. Inert when unset, so
// local dev keeps calling the backend directly via NEXT_PUBLIC_API_URL.
let backendOrigin = (process.env.BACKEND_ORIGIN || '').replace(/\/$/, '');
// Tolerate a scheme-less BACKEND_ORIGIN (e.g. "interviehire-backend-...up.railway.app"):
// Next.js rewrite destinations MUST start with http(s):// or '/', so a value
// without a scheme makes `next build` fail with "Invalid rewrites found" and
// blocks every dashboard deploy. Prepend https:// when the scheme is missing.
if (backendOrigin && !/^https?:\/\//i.test(backendOrigin)) {
  backendOrigin = `https://${backendOrigin}`;
}

const BACKEND_API_PREFIXES = [
  'auth', 'jobs', 'team', 'organisation', 'usage', 'settings', 'public', 'leaderboard',
  'talent-finder',
];

// The interview room lives on the `interview.interviehire.com` subdomain, but
// invite emails (built from the backend's INTERVIEW_ROOM_URL) can point at the
// apex `interviehire.com/interviewcandidateroom`, which this dashboard serves and
// has no such route → 404. Forward those to the room subdomain, preserving the
// ?sessionId query (Next carries query params through on redirects).
const ROOM_ORIGIN = 'https://interview.interviehire.com';

const nextConfig = {
  // Permit the local dashboard to be opened through either loopback hostname.
  // Next.js otherwise rejects cross-origin development asset requests when the
  // page and dev server use different loopback hostnames.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  serverExternalPackages: ['@napi-rs/canvas'],
  // Incremental JS -> TS migration: the dashboard's ESM modules import each other
  // with explicit `.js` extensions (e.g. `from './escape.js'`). As we rename files
  // to `.ts`, those specifiers must keep resolving without touching all 200+ import
  // lines. extensionAlias maps a `.js` request to `.ts`/`.tsx` first, falling back
  // to the real `.js`/`.jsx` for not-yet-converted modules.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.jsx': ['.tsx', '.jsx'],
    };
    return config;
  },
  async redirects() {
    return [
      { source: '/interviewcandidateroom', destination: `${ROOM_ORIGIN}/interviewcandidateroom`, permanent: false },
      { source: '/interviewcandidateroom/:path*', destination: `${ROOM_ORIGIN}/interviewcandidateroom/:path*`, permanent: false },
      { source: '/interview', destination: `${ROOM_ORIGIN}/interviewcandidateroom`, permanent: false },
    ];
  },
  async rewrites() {
    if (!backendOrigin) return [];
    // Note: /api/deepseek, /api/parse-file and /api/fetch-doc are this app's own
    // route handlers and are intentionally NOT proxied.
    //
    // Proxy BOTH the bare collection path and its sub-paths. The bare-path entry
    // (listed first) is essential: without it, a request like "/api/jobs" matches
    // the wildcard with an empty segment and is proxied as "/api/jobs/" (trailing
    // slash). FastAPI then 307-redirects that to an absolute backend URL, leaking
    // the cross-origin backend host to the browser and breaking CORS. Proxying the
    // bare path keeps the whole request first-party (cookie stays same-origin).
    return BACKEND_API_PREFIXES.flatMap((p) => [
      { source: `/api/${p}`, destination: `${backendOrigin}/api/${p}` },
      { source: `/api/${p}/:path*`, destination: `${backendOrigin}/api/${p}/:path*` },
    ]);
  },
};

export default nextConfig;
