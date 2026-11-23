import { describe, it, expect } from "vitest";

process.env.MOCK_HEDERA = "true";
// Limiters share a backend (Upstash in test env) — XFF is honored only
// under TRUST_PROXY_HEADERS; a unique run IP gives every run a fresh bucket.
process.env.TRUST_PROXY_HEADERS = "true";
const { createApp } = await import("../src/server/index");

// SLICE-259-19: agent-readable errors — 429 carries Retry-After +
// X-RateLimit-* + retryable:true; 406/405/400 carry self-correct hints.

const app = createApp();
const RUN = Date.now().toString(36);
const RUN_IP = `10.${(Date.now() % 200) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
const ipHeaders = () => ({
  "x-forwarded-for": RUN_IP,
  "fly-client-ip": RUN_IP,
});

describe("429 agent-readable contract", () => {
  it("knowledge search 429 → Retry-After + X-RateLimit-* + retryable:true", async () => {
    // ANON tier = 10/min; request until rejected.
    let last: Response | null = null;
    for (let i = 0; i < 15; i++) {
      const r = await app.request("/api/v1/agent/knowledge/search?q=x402", {
        headers: ipHeaders(),
      });
      if (r.status === 429) { last = r; break; }
    }
    expect(last, "never hit the anon limit").not.toBeNull();
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(last!.headers.get("x-ratelimit-limit"))).toBeGreaterThan(0);
    expect(last!.headers.get("x-ratelimit-remaining")).toBe("0");
    const body = (await last!.json()) as { retryable?: boolean };
    expect(body.retryable).toBe(true);
  });

  it("interaction intake 429 → Retry-After + X-RateLimit-*", async () => {
    // ANON = 3/min; requests must be VALID (text + key ≥8 chars) to
    // reach the limiter — malformed bodies fail 400 upstream of it.
    let last: Response | null = null;
    for (let i = 0; i < 8; i++) {
      const r = await app.request("/api/v1/agent/interaction", {
        method: "POST",
        headers: {
          ...ipHeaders(),
          "content-type": "application/json",
          "idempotency-key": `itest-${RUN}-${i}`,
        },
        body: JSON.stringify({ text: "rate-limit probe" }),
      });
      if (r.status === 429) { last = r; break; }
    }
    expect(last, "never hit the anon interaction limit").not.toBeNull();
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(last!.headers.get("x-ratelimit-limit")).toBeTruthy();
    const body = (await last!.json()) as { retryable?: boolean };
    expect(body.retryable).toBe(true);
  });

  it("/a2a/challenge 429 → retry-after + retryable:true in body", async () => {
    // a2a challenge limit = 10/min keyed by fly-client-ip.
    let last: Response | null = null;
    for (let i = 0; i < 15; i++) {
      const r = await app.request("/a2a/challenge", { headers: ipHeaders() });
      if (r.status === 429) { last = r; break; }
    }
    expect(last, "challenge limit never hit").not.toBeNull();
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(last!.headers.get("x-ratelimit-limit")).toBeTruthy();
    const body = (await last!.json()) as { error?: { retryable?: boolean } };
    expect(body.error?.retryable).toBe(true);
  });
});

describe("hint bodies", () => {
  it("GET /mcp without SSE accept → 406 + hint", async () => {
    const res = await app.request("/mcp");
    expect(res.status).toBe(406);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("not_acceptable");
    expect(String(body.hint)).toContain("text/event-stream");
    expect(body.requires).toEqual(["text/event-stream"]);
  });

  it("GET /mcp/:namespace → same structured 406", async () => {
    const res = await app.request("/mcp/discovery");
    expect(res.status).toBe(406);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("not_acceptable");
    expect(String(body.hint)).toContain("text/event-stream");
  });

  it("DELETE /mcp → 405 + Allow + explanatory body", async () => {
    const res = await app.request("/mcp", { method: "DELETE" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toContain("GET");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("method_not_allowed");
  });

  it("DELETE /mcp/:namespace → 405 (was JSON-RPC catch-all)", async () => {
    const res = await app.request("/mcp/discovery", { method: "DELETE" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toContain("GET");
  });

  it("GET /api/requests/qa without ?q → 400 + hint with example", async () => {
    const res = await app.request("/api/requests/qa");
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(String(body.hint)).toContain("?q=");
  });
});

describe("/a2a GET — the historical 404 signal", () => {
  it("returns the agent card regardless of Accept (SLICE-234-28 fix holds)", async () => {
    for (const accept of ["*/*", "application/json", "text/html"]) {
      const res = await app.request("/a2a", { headers: { Accept: accept } });
      expect(res.status, `Accept: ${accept}`).toBe(200);
    }
  });
});

describe("?q= example in discovery surfaces", () => {
  it("llms.txt carries the copy-pasteable qa example", async () => {
    const text = await (await app.request("/llms.txt")).text();
    expect(text).toContain("/api/requests/qa?q=");
  });
  it("agent-card carries qa_search_example", async () => {
    const card = (await (
      await app.request("/.well-known/agent-card.json")
    ).json()) as { "x-agentbadge"?: { endpoints?: Record<string, string> } };
    expect(card["x-agentbadge"]?.endpoints?.qa_search_example).toContain(
      "/api/requests/qa?q=",
    );
  });
});
