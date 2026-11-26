/**
 * EPIC-233 SLICE-233-10 — arc-audit remediation proofs.
 * Every test here encodes a finding from
 * docs/EPICS/233-agent-protocol-exposure/reviews/REVIEW-FINDINGS-233.md:
 *   C1  mixed DNS answers rejected (covered in ssrf-dns-pin.test.ts)
 *   C2  delivery connects through the DNS-pinned IP, never re-resolves
 *   H1  per-request webhook secret (derived, returned at submit)
 *   H2  IPv6 transition/link-local prefixes no longer bypass ip-guard
 *   H3  unreadable body charged HEAVY (fail-closed)
 *   M2  DNS blip at delivery is retryable, not dead-letter
 *   M7  callback_url rejects userinfo + non-443 ports
 *   M12 non-object JSON → -32600; handler throw → -32603
 *   M13 poll/webhook project record.response through the allowlist
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

import { isBlockedIp } from "../../src/agent-readiness/scanner/ssrf/ip-guard";
import {
  deriveWebhookSecret,
  verifyWebhookSignature,
  webhookSecretForRequest,
} from "../../src/server/lib/webhooks/sign";
import {
  deliverWebhook,
  type WebhookDeliverDeps,
} from "../../src/server/lib/webhooks/deliver";
import { publicResponseFor } from "../../src/server/lib/request-inbox/poll";
import type { CallbackUrlCheck } from "../../src/server/lib/request-inbox/callback-url";

// ─── H2: IPv6 prefix coverage ────────────────────────────

describe("arc-audit H2 — IPv6 transition prefixes blocked", () => {
  const blocked = [
    "64:ff9b::a9fe:a9fe", // NAT64 → 169.254.169.254 metadata
    "64:ff9b::169.254.169.254",
    "64:ff9b::7f00:1", // NAT64 → 127.0.0.1
    "2002:7f00:1::", // 6to4 → 127.0.0.1
    "2002:a9fe:a9fe::", // 6to4 → 169.254.169.254
    "::7f00:1", // v4-compatible → 127.0.0.1
    "::127.0.0.1",
    "::a9fe:a9fe", // v4-compatible → 169.254.169.254
    "fe90::1", // link-local /10 (only fe80 was covered)
    "febf::ffff",
    "fec0::1", // site-local
    "feff::1",
    "fd00:ec2::254", // cloud-metadata v6 + ULA in compressed form
    "fc99::1", // ULA fc00::/7 compressed
    "0:0:0:0:0:ffff:7f00:1", // uncompressed mapped v4
    "[::ffff:10.0.0.1]", // bracketed literal
  ];
  it.each(blocked)("blocks %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it("still allows public v6 and mapped-public v4", () => {
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedIp("::ffff:8.8.8.8")).toBe(false);
  });
});

// ─── C2: pinned delivery ─────────────────────────────────

describe("arc-audit C2 — delivery connects through the pinned IP", () => {
  const payload = { request_id: "rq_test", state: "completed" };

  it("validate→fetch chain hands the pinned IP to the transport", async () => {
    const validateUrl = async (): Promise<CallbackUrlCheck> => ({
      ok: true,
      url: "https://hook.example.net/cb",
      ip: "93.184.216.34",
    });
    // The pinned transport is only exercised when fetchFn is absent —
    // we assert the validator-provided ip is consumed by checking the
    // fetchPinned boundary via a stubbed native fetch.
    const seen: string[] = [];
    const stub = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", stub);
    try {
      const out = await deliverWebhook({
        url: "https://hook.example.net/cb",
        requestId: "rq_1",
        deliveryId: "wh_1",
        payload,
        deps: { validateUrl, secret: "s" } satisfies WebhookDeliverDeps,
      });
      expect(out.ok).toBe(true);
      // fetchPinned rewrites host→ip, keeps Host header/SNI.
      expect(seen[0]).toContain("93.184.216.34");
      expect(seen[0]).not.toContain("hook.example.net/cb");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("M2: unresolvable DNS at delivery is NOT fatal (retries kept)", async () => {
    const validateUrl = async (): Promise<CallbackUrlCheck> => ({
      ok: false,
      reason: "unresolvable",
    });
    const out = await deliverWebhook({
      url: "https://flaky.example.net/cb",
      requestId: "rq_2",
      deliveryId: "wh_2",
      payload,
      deps: { validateUrl },
    });
    expect(out.ok).toBe(false);
    expect(out.fatal).toBe(false);
  });

  it("policy rejections stay fatal (no retry budget burned)", async () => {
    const validateUrl = async (): Promise<CallbackUrlCheck> => ({
      ok: false,
      reason: "unsafe_target",
    });
    const out = await deliverWebhook({
      url: "https://internal.example.net/cb",
      requestId: "rq_3",
      deliveryId: "wh_3",
      payload,
      deps: { validateUrl },
    });
    expect(out.fatal).toBe(true);
  });
});

// ─── H1: per-request signing secret ──────────────────────

describe("arc-audit H1 — per-request webhook secret", () => {
  const master = "master-test-secret";

  it("derives a distinct whsec_ secret per request id", () => {
    const a = deriveWebhookSecret(master, "rq_aaa");
    const b = deriveWebhookSecret(master, "rq_bbb");
    expect(a).toMatch(/^whsec_/);
    expect(a).not.toBe(b);
    // deterministic — the worker re-derives the same value
    expect(deriveWebhookSecret(master, "rq_aaa")).toBe(a);
  });

  it("receiver verifies with THEIR secret; a foreign secret fails", () => {
    const body = JSON.stringify({ request_id: "rq_aaa", state: "completed" });
    const ts = 1_700_000_000;
    const secretA = deriveWebhookSecret(master, "rq_aaa");
    const secretB = deriveWebhookSecret(master, "rq_bbb");
    const sig = `t=${ts},v1=${createHmac("sha256", secretA)
      .update(`${ts}.${body}`)
      .digest("hex")}`;
    expect(
      verifyWebhookSignature(secretA, sig, body, ts + 10),
    ).toBe(true);
    expect(
      verifyWebhookSignature(secretB, sig, body, ts + 10),
    ).toBe(false);
    // and the old shared-key verifier can't verify either
    expect(verifyWebhookSignature(master, sig, body, ts + 10)).toBe(
      false,
    );
  });

  it("webhookSecretForRequest returns undefined without master (dev)", () => {
    const prev = process.env.WEBHOOK_SIGNING_SECRET;
    delete process.env.WEBHOOK_SIGNING_SECRET;
    try {
      expect(webhookSecretForRequest("rq_x")).toBeUndefined();
      process.env.WEBHOOK_SIGNING_SECRET = master;
      expect(webhookSecretForRequest("rq_x")).toMatch(/^whsec_/);
    } finally {
      if (prev === undefined) delete process.env.WEBHOOK_SIGNING_SECRET;
      else process.env.WEBHOOK_SIGNING_SECRET = prev;
    }
  });
});

// ─── M7: userinfo/port rejected at intake ────────────────

describe("arc-audit M7 — callback_url surface restrictions", () => {
  it("rejects userinfo and non-443 ports", async () => {
    const { validateCallbackUrl } = await import(
      "../../src/server/lib/request-inbox/callback-url"
    );
    for (const bad of [
      "https://user:pass@example.com/cb",
      "https://user@example.com/cb",
      "https://example.com:8443/cb",
    ]) {
      const r = await validateCallbackUrl(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("unsafe_target");
    }
  });
});

// ─── M13: response allowlist ─────────────────────────────

describe("arc-audit M13 — response strips internal keys", () => {
  it("drops internal/_-prefixed keys, keeps free-form shape", () => {
    expect(
      publicResponseFor({
        answer: "done",
        steps: ["a", "b"],
        fpHash: "x",
        _debug: "ops-only",
        agentId: "agent-7",
      }),
    ).toEqual({ answer: "done", steps: ["a", "b"] });
  });
  it("passes primitives and strips inside object array elements", () => {
    expect(publicResponseFor("plain answer")).toBe("plain answer");
    expect(publicResponseFor(null)).toBeNull();
    expect(
      publicResponseFor([{ answer: "a", _leak: "x" }, "s"]),
    ).toEqual([{ answer: "a" }, "s"]);
  });
});

// ─── M12: JSON-RPC envelope hardening ────────────────────

describe("arc-audit M12 — JSON-RPC malformed bodies stay in-envelope", () => {
  beforeEach(() => {
    process.env.MCP_ABUSE_ENABLED = "0";
  });

  it("non-object JSON → -32600; params:null → clean call path", async () => {
    const { mcpAgentInteractionRoutes } = await import(
      "../../src/server/routes/mcp-agent-interaction"
    );
    for (const raw of ["null", "42", '"x"']) {
      const res = await mcpAgentInteractionRoutes.request(
        "/mcp/agent-interaction",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: raw,
        },
      );
      const j = await res.json();
      expect(j.error?.code).toBe(-32600);
    }
    const res2 = await mcpAgentInteractionRoutes.request(
      "/mcp/agent-interaction",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: null,
        }),
      },
    );
    const j2 = await res2.json();
    expect(j2.error?.code).toBe(-32602); // missing name — clean param error
  });
});
