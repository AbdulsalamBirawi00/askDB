import { createGoogle } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, generateText, Output, RetryError, type LanguageModel } from "ai";
import { z } from "zod";

export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_GOOGLE_MODEL = "gemini-3.5-flash";
export const DEFAULT_OLLAMA_MODEL = "qwen2.5-coder:7b";

/** Keys and models. Every provider is optional; the configured ones are tried in order. */
export type ProviderConfig = {
  groqApiKey?: string;
  groqModel?: string;
  googleApiKey?: string;
  googleModel?: string;
  /** Development only: a local Ollama server, e.g. http://localhost:11434/v1. */
  ollamaBaseUrl?: string;
  ollamaModel?: string;
};

export type ProviderName = "ollama" | "groq" | "google";

type Candidate = { provider: ProviderName; model: string; languageModel: LanguageModel };

/** Ollama (if set, for local work), then Groq, then Gemini as the fallback. */
export function configuredModels(config: ProviderConfig): Candidate[] {
  const out: Candidate[] = [];
  if (config.ollamaBaseUrl) {
    const model = config.ollamaModel || DEFAULT_OLLAMA_MODEL;
    const ollama = createOpenAICompatible({
      name: "ollama",
      baseURL: config.ollamaBaseUrl,
      supportsStructuredOutputs: true,
    });
    out.push({ provider: "ollama", model, languageModel: ollama(model) });
  }
  if (config.groqApiKey) {
    const model = config.groqModel || DEFAULT_GROQ_MODEL;
    out.push({
      provider: "groq",
      model,
      languageModel: createGroq({ apiKey: config.groqApiKey })(model),
    });
  }
  if (config.googleApiKey) {
    const model = config.googleModel || DEFAULT_GOOGLE_MODEL;
    out.push({
      provider: "google",
      model,
      languageModel: createGoogle({ apiKey: config.googleApiKey })(model),
    });
  }
  return out;
}

export class NoProviderError extends Error {
  constructor() {
    super("No language model is configured");
    this.name = "NoProviderError";
  }
}

/** Every configured provider failed. `causes` stay server-side (they can hold provider details). */
export class ProvidersFailedError extends Error {
  constructor(public readonly causes: { provider: ProviderName; status?: number }[]) {
    super("The language model is not available right now. Try again in a minute");
    this.name = "ProvidersFailedError";
  }
}

function statusOf(error: unknown): number | undefined {
  const inner = RetryError.isInstance(error) ? error.lastError : error;
  return APICallError.isInstance(inner) ? inner.statusCode : undefined;
}

/**
 * Worth trying the next provider: rate limit (429), server error or outage (5xx),
 * timeout, or a network failure with no response at all. Not a 400 (bad request,
 * our bug) and not a schema mismatch: the next provider would get the same input.
 */
export function shouldFallBack(error: unknown): boolean {
  const status = statusOf(error);
  if (status === undefined) {
    const inner = RetryError.isInstance(error) ? error.lastError : error;
    // No HTTP status: network error or abort. Validation errors are AI SDK errors with a name.
    return !(
      inner instanceof Error && /TypeValidation|JSONParse|NoObjectGenerated/.test(inner.name)
    );
  }
  return status === 408 || status === 429 || status >= 500 || status === 401 || status === 403;
}

export type Generation<T> = {
  output: T;
  provider: ProviderName;
  model: string;
  tokens: number | null;
};

/**
 * Structured generation with fallback. Each provider gets one attempt (no SDK
 * retries), so a 429 from Groq moves to Gemini at once instead of waiting.
 */
export async function generateWithFallback<S extends z.ZodType>(
  config: ProviderConfig,
  request: { instructions: string; prompt: string; schema: S; abortSignal?: AbortSignal },
): Promise<Generation<z.infer<S>>> {
  const candidates = configuredModels(config);
  if (candidates.length === 0) throw new NoProviderError();
  const causes: { provider: ProviderName; status?: number }[] = [];
  for (const [index, candidate] of candidates.entries()) {
    try {
      const result = await generateText({
        model: candidate.languageModel,
        instructions: request.instructions,
        prompt: request.prompt,
        output: Output.object({ schema: request.schema }),
        temperature: 0,
        maxRetries: 0,
        abortSignal: request.abortSignal,
      });
      return {
        output: result.output as z.infer<S>,
        provider: candidate.provider,
        model: candidate.model,
        tokens: result.usage.totalTokens ?? null,
      };
    } catch (error) {
      causes.push({ provider: candidate.provider, status: statusOf(error) });
      const isLast = index === candidates.length - 1;
      if (isLast || !shouldFallBack(error)) {
        if (isLast && shouldFallBack(error)) throw new ProvidersFailedError(causes);
        throw error;
      }
    }
  }
  throw new ProvidersFailedError(causes);
}
