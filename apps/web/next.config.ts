import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  env: {
    NEXT_PUBLIC_SERVER_BASE_URL: process.env.NEXT_PUBLIC_SERVER_BASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_XY2API_WEB_URL: process.env.NEXT_PUBLIC_XY2API_WEB_URL,
  },
  experimental: {
    // React Compiler memoizes components and hooks at build time, so typing
    // in a prompt or a job ticking no longer re-renders the whole page.
    // Components that break the Rules of React are skipped, not miscompiled.
    reactCompiler: true,
  },
};

export default nextConfig;
