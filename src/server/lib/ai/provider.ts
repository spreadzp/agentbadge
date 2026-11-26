/**
 * EPIC-232 (SLICE-232-1, D-232-1): LLM provider seam.
 *
 * `LlmProvider.complete({system, user, jsonSchema?, maxTokens,
 * temperature}) → {text, usage, model}` — one contract covers OpenAI,
 * OpenRouter (→ Claude/Gemini), local vLLM/Ollama. Pure fetch, NO SDK
 * (landmine). `OpenAiCompatibleProvider` posts to
 * `{base}/v1/chat/completions` with `response_format: json_schema`
 * when a schema is supplied; a schema-retry re-asks once on unparseable
 * JSON (own retry, not provider retries).
 *
 * Fail-open is the caller's job — complete() throws `LlmError` with a
 * machine `kind` the worker maps onto AiRun.status
 * (timeout|invalid_json|error). Provider absence (no baseUrl/key)
 * surfaces as config, not an exception — `createOpenAiProvider`
 * returns null.
 */

import type { AiUsage } from "./types";

export interface LlmCompleteRequest {
  system: string;
  user: string;
  /** When set, provider is asked for JSON-schema-structured output. */
  jsonSchema?: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
  maxTokens?: number;
  temperature?: number;
}

export interface LlmCompleteResult {
  text: string;
  usage: AiUsage;
  model: string;
}

export type LlmErrorKind =
  | "timeout"
  | "http"
  | "network"
  | "invalid_json"
  | "invalid_response";

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly httpStatus?: number;
  constructor(kind: LlmErrorKind, message: string, httpStatus?: number) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

export interface LlmProvider {
  /** Stable provider id written to AiRun.provider. */
  readonly id: string;
  complete(req: LlmCompleteRequest): Promise<LlmCompleteResult>;
}

/** Minimal fetch seam — the subset the provider actually calls. */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface OpenAiProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  retryOnce: boolean;
  /** Extra retry delay ms (default 250) — injectable for tests. */
  backoffMs?: number;
  /** Provider id label (default "openai-compatible"). */
  id?: string;
  /** Fetch/sleep seams for tests. */
  fetchImpl?: FetchLike;
  sleepImpl?: (ms: number) => Promise<void>;
}

/** OpenAI /v1/chat/completions response (subset we consume). */
interface ChatCompletionResponse {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; type?: string };
}

const RETRYABLE_HTTP = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const INVALID_JSON_HINT =
  "\n\nReturn ONLY valid JSON matching the requested schema. No prose, no markdown fences.";

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly id: string;
  private readonly opts: OpenAiProviderOptions & { backoffMs: number };

  constructor(opts: OpenAiProviderOptions) {
    this.opts = { backoffMs: 250, ...opts };
    this.id = opts.id ?? "openai-compatible";
  }

  private endpoint(): string {
    const base = this.opts.baseUrl.replace(/\/+$/, "");
    return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  }

  private body(req: LlmCompleteRequest, schemaRetry: boolean): string {
    const messages: { role: string; content: string }[] = [
      { role: "system", content: req.system },
      {
        role: "user",
        content: schemaRetry ? req.user + INVALID_JSON_HINT : req.user,
      },
    ];
    const payload: Record<string, unknown> = {
      model: this.opts.model,
      messages,
    };
    if (req.maxTokens !== undefined) payload.max_tokens = req.maxTokens;
    if (req.temperature !== undefined) payload.temperature = req.temperature;
    if (req.jsonSchema) {
      payload.response_format = {
        type: "json_schema",
        json_schema: {
          name: req.jsonSchema.name,
          schema: req.jsonSchema.schema,
          strict: req.jsonSchema.strict ?? true,
        },
      };
    }
    return JSON.stringify(payload);
  }

  private async attempt(req: LlmCompleteRequest, schemaRetry: boolean): Promise<LlmCompleteResult> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await fetchImpl(this.endpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: this.body(req, schemaRetry),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new LlmError("timeout", `provider timeout after ${this.opts.timeoutMs}ms`);
      }
      throw new LlmError(
        "network",
        e instanceof Error ? e.message : String(e),
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new LlmError(
        "http",
        `provider HTTP ${res.status}: ${detail.slice(0, 300)}`,
        res.status,
      );
    }

    let data: ChatCompletionResponse;
    try {
      data = (await res.json()) as ChatCompletionResponse;
    } catch {
      throw new LlmError("invalid_response", "provider returned non-JSON body");
    }
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string" || text.length === 0) {
      throw new LlmError(
        "invalid_response",
        `no choices[0].message.content (keys: ${Object.keys(data).join(",")})`,
      );
    }
    if (req.jsonSchema) {
      try {
        JSON.parse(text);
      } catch {
        throw new LlmError("invalid_json", "output is not valid JSON");
      }
    }
    return {
      text,
      usage: {
        prompt: data.usage?.prompt_tokens,
        completion: data.usage?.completion_tokens,
        total: data.usage?.total_tokens,
      },
      model: data.model ?? this.opts.model,
    };
  }

  private retryable(err: LlmError): boolean {
    if (err.kind === "timeout" || err.kind === "network") return true;
    if (err.kind === "http") return RETRYABLE_HTTP.has(err.httpStatus ?? 0);
    return false;
  }

  async complete(req: LlmCompleteRequest): Promise<LlmCompleteResult> {
    const sleep = this.opts.sleepImpl ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const maxAttempts = this.opts.retryOnce ? 2 : 1;
    let lastErr: LlmError | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Second pass doubles as the schema-retry: invalid_json re-asks
      // with the corrective hint (D-232-1 own schema-retry).
      const schemaRetry = attempt > 0 && lastErr?.kind === "invalid_json";
      try {
        return await this.attempt(req, schemaRetry);
      } catch (e) {
        const err = e instanceof LlmError ? e : new LlmError("network", String(e));
        lastErr = err;
        const canRetry = this.retryable(err) || err.kind === "invalid_json";
        if (!canRetry || attempt + 1 >= maxAttempts) throw err;
        await sleep(this.opts.backoffMs);
      }
    }
    throw lastErr ?? new LlmError("network", "unreachable");
  }
}

/**
 * Provider factory — null when the env section is absent or lacks the
 * credentials needed for a real call (fail-open: worker reports a
 * config fault instead of crashing the drain).
 */
export function createOpenAiProvider(cfg?: {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
  retryOnce: boolean;
}): OpenAiCompatibleProvider | null {
  if (!cfg?.apiKey) return null;
  return new OpenAiCompatibleProvider({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    timeoutMs: cfg.timeoutMs,
    retryOnce: cfg.retryOnce,
  });
}
