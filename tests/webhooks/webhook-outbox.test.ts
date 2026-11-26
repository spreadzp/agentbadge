/**
 * SLICE-233-4: webhook outbox + worker — enqueue-on-terminal at the
 * RequestStore.transition commit point, signed delivery, persisted
 * retry schedule, dead-letter, SSRF redirect guard (D-233-5).
 */
import { describe, expect, it } from "vitest";

import { createMemoryRequestInboxStores } from "../../src/server/lib/request-inbox/db-stores";
import { drainWebhookOutbox } from "../../src/server/lib/webhooks/worker";
import {
  signWebhookBody,
  verifyWebhookSignature,
} from "../../src/server/lib/webhooks/sign";
import { assertSafeTarget } from "../../src/agent-readiness/scanner/ssrf/ip-guard";
import type { SubmitInput } from "../../src/server/lib/request-inbox/store";
import type { WebhookOutboxRecord } from "../../src/server/lib/webhooks/types";

const mkSubmit = (over: Partial<SubmitInput> = {}): SubmitInput => ({
  id: `rq_${Math.random().toString(16).slice(2, 18)}`,
  state: "submitted",
  kind: "question",
  payload: { question: "q" },
  fingerprint: { ip: null, ua: "t/1", referer: null, src: null, headers: {} },
  fpHash: `fp_${Math.random().toString(16).slice(2)}`,
  expiresAtMs: Date.now() + 60_000,
  ...over,
});

/** Sync per-hop validator for tests — assertSafeTarget only (no DNS):
 *  IP literals in fixtures are evaluated without resolver calls. */
const syncValidate = async (raw: string) => {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false as const, reason: "invalid_url" as const };
  }
  if (u.protocol !== "https:") {
    return { ok: false as const, reason: "scheme" as const };
  }
  try {
    assertSafeTarget(u.hostname);
  } catch {
    return { ok: false as const, reason: "unsafe_target" as const };
  }
  return { ok: true as const, url: u.toString() };
};

const res = (status: number, headers: Record<string, string> = {}) =>
  new Response(status < 300 ? "ok" : null, { status, headers });

describe("enqueue-on-terminal (same commit point as transition)", () => {
  it("completed transition + callback_url → queued outbox row with public projection", async () => {
    const stores = createMemoryRequestInboxStores();
    await stores.requests.submit(
      mkSubmit({ callbackUrl: "https://93.184.216.34/hook" }),
    );
    const id = (await stores.requests.listByState({ limit: 1 }))[0]!.id;
    const moved = await stores.requests.transition(id, "submitted", "completed", {
      response: { answer: "done" },
    });
    expect(moved).not.toBeNull();

    const rows = await stores.webhooks.listForRequest(id);
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(0);
    expect(row.callbackUrl).toBe("https://93.184.216.34/hook");
    // Public projection only — no fingerprint/agentId/callbackUrl leak.
    expect(row.payload).toEqual({
      event: "request.terminal",
      request_id: id,
      state: "completed",
      response: { answer: "done" },
      created_at: moved!.createdAtMs,
      expires_at: moved!.expiresAtMs,
    });
    expect(row.payload.callbackUrl).toBeUndefined();
    expect(row.payload.fingerprint).toBeUndefined();
  });

  it("no callback_url → no row; non-terminal transition → no row; repeat terminal → still one row", async () => {
    const stores = createMemoryRequestInboxStores();
    const plain = await stores.requests.submit(mkSubmit({}));
    await stores.requests.transition(
      plain.record.id,
      "submitted",
      "completed",
      { response: {} },
    );
    expect(await stores.webhooks.listForRequest(plain.record.id)).toEqual([]);

    const hooked = await stores.requests.submit(
      mkSubmit({ callbackUrl: "https://93.184.216.34/h" }),
    );
    await stores.requests.transition(
      hooked.record.id,
      "submitted",
      "working",
    );
    expect(
      await stores.webhooks.listForRequest(hooked.record.id),
    ).toEqual([]);
    await stores.requests.transition(
      hooked.record.id,
      "working",
      "failed",
      { response: { error: "x" } },
    );
    expect(
      (await stores.webhooks.listForRequest(hooked.record.id)).length,
    ).toBe(1);
    // Idempotent — a second enqueue (repeat terminal edge) does not dup.
    await stores.webhooks.enqueue(
      (await stores.webhooks.listForRequest(hooked.record.id))[0]!,
    );
    expect(
      (await stores.webhooks.listForRequest(hooked.record.id)).length,
    ).toBe(1);
  });
});

describe("worker: deliver → resolve", () => {
  const seed = async (): Promise<{
    stores: ReturnType<typeof createMemoryRequestInboxStores>;
    row: WebhookOutboxRecord;
  }> => {
    const stores = createMemoryRequestInboxStores();
    const { record } = await stores.requests.submit(
      mkSubmit({ callbackUrl: "https://93.184.216.34/hook" }),
    );
    await stores.requests.transition(record.id, "submitted", "completed", {
      response: { answer: "a" },
    });
    const row = (await stores.webhooks.listForRequest(record.id))[0]!;
    return { stores, row };
  };

  it("signed POST: X-AgentBadge-Signature verifies over <t>.<body>; done on 2xx", async () => {
    const { stores, row } = await seed();
    const seen: { headers: Headers; body: string }[] = [];
    const fetchFn: typeof fetch = (async (_u: unknown, init: RequestInit) => {
      seen.push({
        headers: new Headers(init.headers as HeadersInit),
        body: init.body as string,
      });
      return res(200);
    }) as typeof fetch;

    const out = await drainWebhookOutbox({
      outbox: stores.webhooks,
      fetchFn,
      validateUrl: syncValidate,
      secret: "test-secret",
      nowMs: () => 1_800_000_000_000,
    });
    expect(out.delivered).toBe(1);
    expect((await stores.webhooks.get(row.id))?.status).toBe("done");

    const sig = seen[0]!.headers.get("X-AgentBadge-Signature")!;
    expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(
      verifyWebhookSignature(
        "test-secret",
        sig,
        seen[0]!.body,
        1_800_000_000,
      ),
    ).toBe(true);
    // Wrong secret / tampered body / stale ts all fail verification.
    expect(
      verifyWebhookSignature("other", sig, seen[0]!.body, 1_800_000_000),
    ).toBe(false);
    expect(
      verifyWebhookSignature("test-secret", sig, "{}", 1_800_000_000),
    ).toBe(false);
    expect(
      verifyWebhookSignature(
        "test-secret",
        sig,
        seen[0]!.body,
        1_800_000_000 + 600,
      ),
    ).toBe(false);
    expect(seen[0]!.headers.get("X-AgentBadge-Request-Id")).toBe(
      row.requestId,
    );
  });

  it("failing delivery → requeue on backoff schedule; exhausted attempts → dead-letter", async () => {
    const { stores, row } = await seed();
    const fetchFn: typeof fetch = (async () => res(500)) as unknown as typeof fetch;
    let now = Date.now();
    const deps = {
      outbox: stores.webhooks,
      fetchFn,
      validateUrl: syncValidate,
      secret: "s",
      nowMs: () => now,
      maxAttempts: 3,
    };

    const first = await drainWebhookOutbox(deps);
    expect(first.requeued).toBe(1);
    let r = (await stores.webhooks.get(row.id))!;
    expect(r.status).toBe("queued");
    expect(r.attempts).toBe(1);
    expect(r.nextAttemptAtMs).toBe(now + 30_000); // backoff[0]

    now += 30_000;
    const second = await drainWebhookOutbox(deps);
    expect(second.requeued).toBe(1);
    r = (await stores.webhooks.get(row.id))!;
    expect(r.attempts).toBe(2);
    expect(r.nextAttemptAtMs).toBe(now + 120_000); // backoff[1]

    now += 120_000;
    const third = await drainWebhookOutbox(deps);
    expect(third.deadLettered).toBe(1);
    r = (await stores.webhooks.get(row.id))!;
    expect(r.status).toBe("failed");
    expect(r.attempts).toBe(3);
    expect(r.lastError).toContain("500");

    // Dead rows are never claimed again.
    now += 10_000_000;
    const fourth = await drainWebhookOutbox(deps);
    expect(fourth.processed).toBe(0);
  });

  it("delivering-lease reclaim: stale in-flight row is re-claimed", async () => {
    const { stores, row } = await seed();
    const calls: string[] = [];
    const fetchFn: typeof fetch = (async () => {
      calls.push("x");
      return res(200);
    }) as unknown as typeof fetch;
    let now = Date.now();
    const deps = {
      outbox: stores.webhooks,
      fetchFn,
      validateUrl: syncValidate,
      nowMs: () => now,
      leaseMs: 60_000,
    };
    await stores.webhooks.claim(now, 25, 60_000); // sim crash: claimed, never resolved
    now += 61_000;
    const out = await drainWebhookOutbox(deps);
    expect(out.processed).toBe(1);
    expect(out.delivered).toBe(1);
    expect(calls.length).toBe(1);
    expect((await stores.webhooks.get(row.id))?.status).toBe("done");
  });
});

describe("delivery SSRF guard", () => {
  it("302 → private redirect target: fatal dead-letter, no follow", async () => {
    const stores = createMemoryRequestInboxStores();
    const { record } = await stores.requests.submit(
      mkSubmit({ callbackUrl: "https://93.184.216.34/hook" }),
    );
    await stores.requests.transition(record.id, "submitted", "completed", {
      response: {},
    });
    const urls: string[] = [];
    const fetchFn: typeof fetch = (async (u: unknown) => {
      urls.push(String(u));
      return res(302, { location: "https://169.254.169.254/meta" });
    }) as typeof fetch;

    const out = await drainWebhookOutbox({
      outbox: stores.webhooks,
      fetchFn,
      validateUrl: syncValidate,
      nowMs: () => Date.now(),
    });
    expect(out.deadLettered).toBe(1); // fatal — no retry budget burned
    expect(urls.length).toBe(1); // the private hop was never fetched
    const row = (await stores.webhooks.listForRequest(record.id))[0]!;
    expect(row.status).toBe("failed");
    expect(row.lastError).toContain("redirect target rejected");
  });

  it("302 → public redirect target: followed with re-validation", async () => {
    const stores = createMemoryRequestInboxStores();
    const { record } = await stores.requests.submit(
      mkSubmit({ callbackUrl: "https://93.184.216.34/hook" }),
    );
    await stores.requests.transition(record.id, "submitted", "completed", {
      response: {},
    });
    const urls: string[] = [];
    const fetchFn: typeof fetch = (async (u: unknown) => {
      urls.push(String(u));
      if (urls.length === 1) {
        return res(302, { location: "https://93.184.216.35/h2" });
      }
      return res(200);
    }) as typeof fetch;

    const out = await drainWebhookOutbox({
      outbox: stores.webhooks,
      fetchFn,
      validateUrl: syncValidate,
      nowMs: () => Date.now(),
    });
    expect(out.delivered).toBe(1);
    expect(urls).toEqual([
      "https://93.184.216.34/hook",
      "https://93.184.216.35/h2",
    ]);
  });
});

describe("signature unit", () => {
  it("signWebhookBody format + verifyWebhookSignature round-trip", () => {
    const sig = signWebhookBody("s3cret", 1700000000, '{"a":1}');
    expect(sig).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
    expect(
      verifyWebhookSignature("s3cret", sig, '{"a":1}', 1700000000),
    ).toBe(true);
    expect(
      verifyWebhookSignature("s3cret", "t=bad,v1=x", "{}", 1700000000),
    ).toBe(false);
    expect(
      verifyWebhookSignature("s3cret", "v1=abc", "{}", 1700000000),
    ).toBe(false);
  });
});
