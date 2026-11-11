import type { NextConfig } from "next";
import { parseEnv } from "./src/lib/env.schema";

// Fail fast on `next dev`, `next build`, and `next start` instead of on the first request.
parseEnv(process.env);

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "lh3.googleusercontent.com" }],
  },
};

export default nextConfig;
