import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string({ error: "is required" })
    .min(1, { error: "is required", abort: true })
    .refine((value) => /^postgres(ql)?:\/\//.test(value), {
      error: "must be a postgres:// or postgresql:// connection string",
    }),
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
