import { z } from "zod";

const url = z.url();

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: url,
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1)
});

const serverSchema = publicSchema.extend({
  DATABASE_URL: z.string().min(1).refine(
    (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
    "DATABASE_URL must use the postgres:// or postgresql:// scheme"
  ),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SENTRY_DSN: z.union([url, z.literal("")]).optional(),
  AI_API_KEY: z.union([z.string().min(1), z.literal("")]).optional(),
  AI_MODEL: z.string().min(1).default("gpt-5-mini"),
  AI_BASE_URL: url.default("https://api.openai.com/v1")
}).superRefine((value, context) => {
  if (value.NODE_ENV === "production" && !value.SENTRY_DSN) {
    context.addIssue({ code: "custom", path: ["SENTRY_DSN"], message: "SENTRY_DSN is required in production" });
  }
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

export function parsePublicEnv(input: Record<string, string | undefined>): PublicEnv {
  return publicSchema.parse(input);
}

export function parseServerEnv(input: Record<string, string | undefined>): ServerEnv {
  return serverSchema.parse(input);
}
