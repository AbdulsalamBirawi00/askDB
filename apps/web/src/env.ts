import { z } from "zod";

const required = (schema: z.ZodString = z.string()) =>
  z.string({ error: "is required" }).min(1, { error: "is required", abort: true }).pipe(schema);

/** Unset and "" both mean "not configured" for optional variables. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: required().refine((value) => /^postgres(ql)?:\/\//.test(value), {
      error: "must be a postgres:// or postgresql:// connection string",
    }),
    // Signs session cookies. Generate with `openssl rand -base64 32`.
    BETTER_AUTH_SECRET: required(z.string().min(32, { error: "must be at least 32 characters" })),
    // Public origin of the app. Optional: Better Auth falls back to the request's origin.
    BETTER_AUTH_URL: optional(z.url({ error: "must be a URL" })),
    // GitHub OAuth app. Both or neither; without them the GitHub button is hidden.
    GITHUB_CLIENT_ID: optional(z.string()),
    GITHUB_CLIENT_SECRET: optional(z.string()),
    // AES-256-GCM key for saved connection URLs: 32 bytes, base64. `openssl rand -base64 32`.
    CONNECTION_ENCRYPTION_KEY: required(
      z.string().refine((v) => Buffer.from(v, "base64").length === 32, {
        error: "must be 32 bytes, base64-encoded",
      }),
    ),
    // Lets users connect to localhost/private addresses. Only for local development and CI.
    ALLOW_PRIVATE_DB_HOSTS: z
      .enum(["true", "false", ""])
      .optional()
      .transform((v) => v === "true"),
    // Language models (Stage 3). All optional; configured ones are tried in order:
    // Ollama (local development), then Groq, then Gemini as the fallback on 429 or outage.
    GROQ_API_KEY: optional(z.string()),
    GROQ_MODEL: optional(z.string()),
    GOOGLE_GENERATIVE_AI_API_KEY: optional(z.string()),
    GOOGLE_MODEL: optional(z.string()),
    // Second Gemini model, tried when the first is overloaded. "none" turns it off.
    GOOGLE_FALLBACK_MODEL: optional(z.string()),
    OLLAMA_BASE_URL: optional(z.url({ error: "must be a URL" })),
    OLLAMA_MODEL: optional(z.string()),
    // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Without it, cron routes refuse every call.
    CRON_SECRET: optional(z.string().min(16, { error: "must be at least 16 characters" })),
  })
  .refine((env) => !!env.GITHUB_CLIENT_ID === !!env.GITHUB_CLIENT_SECRET, {
    path: ["GITHUB_CLIENT_ID"],
    error: "and GITHUB_CLIENT_SECRET must be set together",
  });

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment variables:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "EnvError";
  }
}

/**
 * Validates an environment object. Throws an EnvError naming every bad variable.
 * Never includes variable values in the message, so secrets cannot leak into logs.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`);
  throw new EnvError(issues);
}

let cached: Env | undefined;

/** Validated process env, parsed once. Called at startup from instrumentation.ts. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
