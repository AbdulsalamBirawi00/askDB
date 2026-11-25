import { createGoogle } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, generateText, Output, RetryError, streamText, type LanguageModel } from "ai";
import { z } from "zod";

export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_GOOGLE_MODEL = "gemini-3.5-flash";
/** Same key, a lighter model: Google's overloads often hit one model and not the other. */
export const DEFAULT_GOOGLE_FALLBACK_MODEL = "gemini-3.5-flash-lite";
/** Same key again, Google's open model: its own (much larger) free daily quota. */
export const DEFAULT_GEMMA_MODEL = "gemma-4-31b-it";
/** Z.ai (Zhipu) GLM: a free model from a second company, for when every Google model refuses. */
export const DEFAULT_ZAI_MODEL = "glm-4.5-flash";
export const ZAI_BASE_URL = "https://api.z.ai/api/paas/v4";
/** NVIDIA's free API (build.nvidia.com): open models from several labs, rate limited per minute. */
export const DEFAULT_NVIDIA_MODEL = "moonshotai/kimi-k3.1-pro";
export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const DEFAULT_OLLAMA_MODEL = "qwen2.5-coder:7b";

/** Keys and models. Every provider is optional; the configured ones are tried in order. */
export type ProviderConfig = {
  groqApiKey?: string;
  groqModel?: string;
  googleApiKey?: string;
  googleModel?: string;
  /** Tried after `googleModel` on 429/5xx. "none" turns it off. */
  googleFallbackModel?: string;
  /** A Gemma model on the same Google key. "none" turns it off. */
  gemmaModel?: string;
  zaiApiKey?: string;
  zaiModel?: string;
  nvidiaApiKey?: string;
  nvidiaModel?: string;
  /** Development only: a local Ollama server, e.g. http://localhost:11434/v1. */
  ollamaBaseUrl?: string;
  ollamaModel?: string;
};

export type ProviderName = "ollama" | "groq" | "google" | "zai" | "nvidia";

/**
 * How a model returns structured output. "native": the provider enforces the JSON schema.
 * "prompt": the schema goes into the instructions and the reply is parsed and checked
 * with Zod, for models whose schema support is missing or unreliable.
 */
type JsonMode = "native" | "prompt";

type Candidate = {
  provider: ProviderName;
  model: string;
  languageModel: LanguageModel;
  json: JsonMode;
};

/**
 * Which models go first. "quality" (SQL): the strongest model first, the free-tier
 * workhorses after it. "cheap" (summaries): the lightest models first, so the scarce
 * quota of the strongest model is kept for SQL.
 */
export type ModelOrder = "quality" | "cheap";

type Slot = "groq" | "gemini" | "geminiLite" | "gemma" | "zai" | "nvidia";

const ORDER: Record<ModelOrder, Slot[]> = {
  quality: ["groq", "gemini", "zai", "nvidia", "geminiLite", "gemma"],
  cheap: ["geminiLite", "gemma", "zai", "nvidia", "groq", "gemini"],
};

/** Every configured model, Ollama first when set (local work), then in `order`. */
export function configuredModels(
  config: ProviderConfig,
  order: ModelOrder = "quality",
): Candidate[] {
  const slots: Partial<Record<Slot, Candidate>> = {};
  if (config.groqApiKey) {
    const model = config.groqModel || DEFAULT_GROQ_MODEL;
    slots.groq = {
      provider: "groq",
      model,
      languageModel: createGroq({ apiKey: config.groqApiKey })(model),
      json: "native",
    };
  }
  if (config.googleApiKey) {
    const google = createGoogle({ apiKey: config.googleApiKey });
    const model = config.googleModel || DEFAULT_GOOGLE_MODEL;
    slots.gemini = { provider: "google", model, languageModel: google(model), json: "native" };
    const lite = config.googleFallbackModel || DEFAULT_GOOGLE_FALLBACK_MODEL;
    if (lite !== "none" && lite !== model) {
      slots.geminiLite = {
        provider: "google",
        model: lite,
        languageModel: google(lite),
        json: "native",
      };
    }
    const gemma = config.gemmaModel || DEFAULT_GEMMA_MODEL;
    if (gemma !== "none") {
      slots.gemma = {
        provider: "google",
        model: gemma,
        languageModel: google(gemma),
        json: "prompt",
      };
    }
  }
  if (config.zaiApiKey) {
    const model = config.zaiModel || DEFAULT_ZAI_MODEL;
    const zai = createOpenAICompatible({
      name: "zai",
      baseURL: ZAI_BASE_URL,
      apiKey: config.zaiApiKey,
    });
    slots.zai = {
      provider: "zai",
      model,
      languageModel: zai(model),
      json: "prompt",
    };
  }

  if (config.nvidiaApiKey) {
    const model = config.nvidiaModel || DEFAULT_NVIDIA_MODEL;
    const nvidia = createOpenAICompatible({
      name: "nvidia",
      baseURL: NVIDIA_BASE_URL,
      apiKey: config.nvidiaApiKey,
    });
    slots.nvidia = { provider: "nvidia", model, languageModel: nvidia(model), json: "prompt" };
  }

  const out: Candidate[] = [];
  if (config.ollamaBaseUrl) {
    const model = config.ollamaModel || DEFAULT_OLLAMA_MODEL;
    const ollama = createOpenAICompatible({
      name: "ollama",
      baseURL: config.ollamaBaseUrl,
      supportsStructuredOutputs: true,
    });
    out.push({ provider: "ollama", model, languageModel: ollama(model), json: "native" });
  }
  for (const slot of ORDER[order]) {
    const candidate = slots[slot];
    if (candidate) out.push(candidate);
  }
  return out;
}

/** A "prompt"-mode reply that is not the JSON asked for. Another model may do better. */
export class UnparseableOutputError extends Error {
  constructor() {
    super("The model did not return the expected JSON");
    this.name = "UnparseableOutputError";
  }
}

/** Instructions appended for "prompt"-mode models. */
export function jsonOnlyInstructions(schema: z.ZodType): string {
  return (
    "Reply with only one JSON object and nothing else: no markdown, no code fences, no text " +
    `before or after it. It must match this JSON Schema:\n${JSON.stringify(z.toJSONSchema(schema))}`
  );
}

/**
 * Reads the JSON object out of a "prompt"-mode reply (tolerating code fences or a
 * sentence around it) and checks it with the schema.
 */
export function parseJsonReply<S extends z.ZodType>(text: string, schema: S): z.infer<S> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new UnparseableOutputError();
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new UnparseableOutputError();
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new UnparseableOutputError();
  return parsed.data;
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
  if (error instanceof UnparseableOutputError) return true;
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
 * retries), so a 429 moves to the next model at once instead of waiting.
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
      if (candidate.json === "prompt") {
        const result = await generateText({
          model: candidate.languageModel,
          instructions: `${request.instructions}\n\n${jsonOnlyInstructions(request.schema)}`,
          prompt: request.prompt,
          temperature: 0,
          maxRetries: 0,
          abortSignal: request.abortSignal,
        });
        return {
          output: parseJsonReply(result.text, request.schema),
          provider: candidate.provider,
          model: candidate.model,
          tokens: result.usage.totalTokens ?? null,
        };
      }
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
  request: {
    instructions: string;
    prompt: string;
    abortSignal?: AbortSignal;
    /** Summaries use "cheap": they do not need the strongest model. */
    order?: ModelOrder;
  },
): AsyncGenerator<string, void, undefined> {
  const candidates = configuredModels(config, request.order);
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
