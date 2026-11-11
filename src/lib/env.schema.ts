import { z } from "zod";

// Runtime variables only. DATABASE_URL_UNPOOLED is read by prisma.config.ts for migrations.
export const envSchema = z.object({
  DATABASE_URL: z.url(),
  AUTH_SECRET: z.string().min(32),
  AUTH_GOOGLE_ID: z.string().min(1),
  AUTH_GOOGLE_SECRET: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Names only, never values: this message can end up in build logs.
    const missing = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid or missing environment variables: ${missing}`);
  }
  return result.data;
}
