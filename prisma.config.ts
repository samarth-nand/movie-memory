import { loadEnvConfig } from "@next/env";
import { defineConfig, env } from "prisma/config";

// Prisma 7's CLI doesn't read env files; reuse Next's loader so .env.local works the same everywhere.
loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Migrations need a direct (unpooled) connection; the app runtime uses the pooled URL via the driver adapter.
  datasource: { url: env("DATABASE_URL_UNPOOLED") },
});
