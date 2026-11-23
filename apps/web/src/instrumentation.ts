import { EnvError, getEnv } from "@/env";

/** Runs once when the server starts. Fails fast if the environment is invalid (T0.3). */
export function register() {
  try {
    getEnv();
  } catch (error) {
    if (error instanceof EnvError && process.env.NEXT_RUNTIME === "nodejs") {
      // Without this, Next logs the error but keeps serving 500s.
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
