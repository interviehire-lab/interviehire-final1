import type { NextConfig } from "next";
const core = process.env.CORE_API_URL ?? "http://127.0.0.1:4100";
const config: NextConfig = { allowedDevOrigins: ["127.0.0.1", "localhost"], async rewrites() { return [{ source: "/api/v2/:path*", destination: `${core}/v2/:path*` }]; } };
export default config;
