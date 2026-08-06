import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The opt-in is only used by constrained validation runtimes that cannot spawn
  // Next's TypeScript child process. Normal local and Vercel builds still typecheck.
  typescript: {
    ignoreBuildErrors: process.env.CODEX_BUILD_NO_SPAWN === "1",
  },
  experimental: {
    workerThreads: process.env.CODEX_BUILD_NO_SPAWN === "1",
    useTypeScriptCli: process.env.CODEX_BUILD_NO_SPAWN !== "1",
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
