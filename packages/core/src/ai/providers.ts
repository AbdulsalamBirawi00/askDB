import { createGoogle } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, generateText, Output, RetryError, streamText, type LanguageModel } from "ai";
import { z } from "zod";

export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_GOOGLE_MODEL = "gemini-3.5-flash";
/** Same key, a lighter model: Google's overloads often hit one model and not the other. */
export const DEFAULT_GOOGLE_FALLBACK_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_OLLAMA_MODEL = "qwen2.5-coder:7b";

/** Keys and models. Every provider is optional; the configured ones are tried in order. */
export type ProviderConfig = {
  groqApiKey?: string;
  groqModel?: string;
  googleApiKey?: string;
  googleModel?: string;
  /** Tried after `googleModel` on 429/5xx. "none" turns it off. */
  googleFallbackModel?: string;
  /** Development only: a local Ollama server, e.g. http://localhost:11434/v1. */
  ollamaBaseUrl?: string;
  ollamaModel?: string;
};

export type ProviderName = "ollama" | "groq" | "google";

type Candidate = { provider: ProviderName; model: string; languageModel: LanguageModel };

/** Ollama (if set, for local work), then Groq, then Gemini, then the lighter Gemini model. */
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
    const google = createGoogle({ apiKey: config.googleApiKey });
    const model = config.googleModel || DEFAULT_GOOGLE_MODEL;
    out.push({ provider: "google", model, languageModel: google(model) });
    const fallback = config.googleFallbackModel || DEFAULT_GOOGLE_FALLBACK_MODEL;
    if (fallback !== "none" && fallback !== model) {
      out.push({ provider: "google", model: fallback, languageModel: google(fallback) });
    }
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
 * Worth trying the next model: rate limit (429), server error or overload (5xx),
 * timeout, a key the provider refuses (401/403), a model it does not serve (404),
 * or a network failure with no response at all. Not a 400 (bad request, our bug)
 * and not a schema mismatch: the next model would get the same input.
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
  return [401, 403, 404, 408, 429].includes(status) || status >= 500;
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

/**
 * Plain-text streaming with fallback. A provider that fails before sending any text is
 * skipped for the next one; once text has started, a failure ends the stream there
 * (the reader already has part of an answer, and starting over would repeat it).
 * Yields text deltas. Throws ProvidersFailedError only when no provider sent anything.
 */
export async function* streamTextWithFallback(
  config: ProviderConfig,
  request: { instructions: string; prompt: string; abortSignal?: AbortSignal },
): AsyncGenerator<string, void, undefined> {
  const candidates = configuredModels(config);
  if (candidates.length === 0) throw new NoProviderError();
  const causes: { provider: ProviderName; status?: number }[] = [];
  for (const candidate of candidates) {
    const result = streamText({
      model: candidate.languageModel,
      instructions: request.instructions,
      prompt: request.prompt,
      temperature: 0,
      maxRetries: 0,
      abortSignal: request.abortSignal,
    });
    let sent = false;
    let failure: unknown = null;
    for await (const part of result.fullStream) {
      if (part.type === "text-delta" && part.text) {
        sent = true;
        yield part.text;
      } else if (part.type === "error") {
        failure = part.error;
        break;
      }
    }
    if (failure === null || sent) return;
    causes.push({ provider: candidate.provider, status: statusOf(failure) });
    if (!shouldFallBack(failure)) throw failure;
  }
  throw new ProvidersFailedError(causes);
}
