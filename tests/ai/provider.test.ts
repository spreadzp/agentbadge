/**
 * SLICE-232-1: OpenAiCompatibleProvider unit tests — mock fetch,
 * json_schema request shape, schema-retry on invalid JSON, timeout
 * and HTTP error mapping. No network.
 */
import { describe, expect, it, vi } from "vitest";

import {
  LlmError,
  OpenAiCompatibleProvider,
} from "../../src/server/lib/ai/provider";
import type { FetchLike } from "../../src/server/lib/ai/provider";

function provider(fetchImpl: FetchLike, over = {}) {
  return new OpenAiCompatibleProvider({
    baseUrl: "https://llm.test",
    apiKey: "k",
    model: "m-1",
    timeoutMs: 5_000,
    retryOnce: true,
    backoffMs: 0,
    sleepImpl: () => Promise.resolve(),
    fetchImpl,
    ...over,
  });
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const completion = (text: string, usage = { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 }) => ({
  model: "m-1-served",
  choices: [{ message: { content: text } }],
  usage,
});

describe("OpenAiCompatibleProvider", () => {
  it("POSTs chat/completions with bearer auth + maps usage", async () => {
    const spy = vi.fn<FetchLike>(async () => ok(completion("hello")));
    const p = provider(spy);
    const out = await p.complete({ system: "s", user: "u" });
    expect(out.text).toBe("hello");
    expect(out.usage).toEqual({ prompt: 3, completion: 5, total: 8 });
    expect(out.model).toBe("m-1-served");
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe("https://llm.test/v1/chat/completions");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer k");
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe("m-1");
    expect(body.messages).toEqual([
      { role: "system", content: "s" },
      { role: "user", content: "u" },
    ]);
    expect(body.response_format).toBeUndefined();
  });

  it("honors a baseUrl already ending in /v1", async () => {
    const spy = vi.fn<FetchLike>(async () => ok(completion("x")));
    const p = provider(spy, { baseUrl: "https://llm.test/v1/" });
    await p.complete({ system: "s", user: "u" });
    expect(spy.mock.calls[0]![0]).toBe("https://llm.test/v1/chat/completions");
  });

  it("sends response_format json_schema and parses JSON output", async () => {
    const spy = vi.fn<FetchLike>(async () =>
      ok(completion('{"label":"bug","confidence":0.9}')),
    );
    const p = provider(spy);
    const out = await p.complete({
      system: "s",
      user: "u",
      jsonSchema: { name: "cls", schema: { type: "object" } },
    });
    expect(JSON.parse(out.text)).toEqual({ label: "bug", confidence: 0.9 });
    const body = JSON.parse(spy.mock.calls[0]![1]?.body as string);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "cls", schema: { type: "object" }, strict: true },
    });
  });

  it("schema-retries once on invalid JSON, then succeeds", async () => {
    const spy = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => ok(completion("not json")))
      .mockImplementationOnce(async () => ok(completion('{"ok":true}')));
    const p = provider(spy);
    const out = await p.complete({
      system: "s",
      user: "u",
      jsonSchema: { name: "x", schema: {} },
    });
    expect(out.text).toBe('{"ok":true}');
    expect(spy).toHaveBeenCalledTimes(2);
    // retry carries the corrective hint
    const body = JSON.parse(spy.mock.calls[1]![1]?.body as string);
    expect(body.messages[1].content).toContain("ONLY valid JSON");
  });

  it("throws LlmError invalid_json after the retry budget is spent", async () => {
    const spy = vi.fn<FetchLike>(async () => ok(completion("still bad")));
    const p = provider(spy);
    await expect(
      p.complete({ system: "s", user: "u", jsonSchema: { name: "x", schema: {} } }),
    ).rejects.toMatchObject({ name: "LlmError", kind: "invalid_json" });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("invalid_json does NOT retry when retryOnce is off", async () => {
    const spy = vi.fn<FetchLike>(async () => ok(completion("bad")));
    const p = provider(spy, { retryOnce: false });
    await expect(
      p.complete({ system: "s", user: "u", jsonSchema: { name: "x", schema: {} } }),
    ).rejects.toMatchObject({ kind: "invalid_json" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("maps HTTP 500 → LlmError http + retries; 400 → no retry", async () => {
    const spy500 = vi.fn<FetchLike>(
      async () => new Response("boom", { status: 500 }),
    );
    await expect(provider(spy500).complete({ system: "s", user: "u" })).rejects.toMatchObject({
      kind: "http",
      httpStatus: 500,
    });
    expect(spy500).toHaveBeenCalledTimes(2);

    const spy400 = vi.fn<FetchLike>(
      async () => new Response("bad req", { status: 400 }),
    );
    await expect(provider(spy400).complete({ system: "s", user: "u" })).rejects.toMatchObject({
      kind: "http",
      httpStatus: 400,
    });
    expect(spy400).toHaveBeenCalledTimes(1);
  });

  it("maps network failure → LlmError network (retried)", async () => {
    const spy = vi.fn<FetchLike>(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(provider(spy).complete({ system: "s", user: "u" })).rejects.toMatchObject({
      kind: "network",
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("maps abort/timeout → LlmError timeout", async () => {
    const spy = vi.fn<FetchLike>(async () => {
      const e = new Error("timed out");
      e.name = "TimeoutError";
      throw e;
    });
    await expect(provider(spy).complete({ system: "s", user: "u" })).rejects.toMatchObject({
      kind: "timeout",
    });
  });

  it("empty/invalid completion shape → invalid_response", async () => {
    const spy = vi.fn<FetchLike>(async () => ok({ model: "m" }));
    await expect(provider(spy).complete({ system: "s", user: "u" })).rejects.toBeInstanceOf(
      LlmError,
    );
  });
});
