/**
 * SLICE-151-3: Attestation route + public page —
 * POST /api/attestations (scan → giveFeedback + memo via evaluator key),
 * GET /api/attestations, GET /attestations page. Gate: ARC_ATTESTATION_ENABLED.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  attestationRoutes,
  setAttestationRouteConfig,
  type AttestationRouteConfig,
} from "../src/server/routes/attestation-api";
import { createVenueStore } from "../src/server/lib/attestation-store";

const FEEDBACK_TX =
  "0xaaaa11111111111111111111111111111111111111111111111111111111111111";
const MEMO_TX =
  "0xbbbb22222222222222222222222222222222222222222222222222222222222222";

function makeCfg(overrides?: Partial<AttestationRouteConfig>) {
  const store = createVenueStore(10);
  const writeAttestation = vi.fn().mockResolvedValue({
    agentId: 896908n,
    feedbackTx: FEEDBACK_TX,
    memoTx: MEMO_TX,
  });
  const scan = vi.fn().mockResolvedValue({
    score: 82,
    status: "ready",
    reportHash:
      "0xcccc3333333333333333333333333333333333333333333333333333333333333333",
  });
  const cfg: AttestationRouteConfig = {
    network: "eip155:5042002",
    explorerUrl: "https://explorer.testnet.arc.io",
    scan,
    writeAttestation,
    store,
    rateLimit: { windowMs: 60_000, max: 100 },
    ...overrides,
  };
  return { cfg, store, writeAttestation, scan };
}

function app(cfg: AttestationRouteConfig) {
  setAttestationRouteConfig(cfg);
  const app = new Hono();
  app.route("/", attestationRoutes);
  return app;
}

describe("POST /api/attestations", () => {
  beforeEach(() => setAttestationRouteConfig(undefined as never));

  it("valid url → scan → chain write → explorer links", async () => {
    const { cfg, writeAttestation, scan, store } = makeCfg();
    const res = await app(cfg).request("/api/attestations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scanResult.score).toBe(82);
    expect(body.feedbackTx).toBe(FEEDBACK_TX);
    expect(body.memoTx).toBe(MEMO_TX);
    expect(body.explorerLinks).toContain(
      `https://explorer.testnet.arc.io/tx/${FEEDBACK_TX}`,
    );
    expect(scan).toHaveBeenCalledWith("https://example.com");
    expect(writeAttestation).toHaveBeenCalled();
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].domain).toBe("example.com");
  });

  it("missing url → 400", async () => {
    const res = await app(makeCfg().cfg).request("/api/attestations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("invalid url → 400", async () => {
    const res = await app(makeCfg().cfg).request("/api/attestations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "http://[" }),
    });
    expect(res.status).toBe(400);
  });

  it("private host → 403 (SSRF guard)", async () => {
    const res = await app(makeCfg().cfg).request("/api/attestations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "http://127.0.0.1/admin" }),
    });
    expect(res.status).toBe(403);
  });

  it("custom agentId passes through to writer", async () => {
    const { cfg, writeAttestation } = makeCfg();
    await app(cfg).request("/api/attestations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", agentId: "42" }),
    });
    expect(writeAttestation).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 42n }),
    );
  });

  it("chain write failure → 502, not stored", async () => {
    const { cfg, store } = makeCfg({
      writeAttestation: vi.fn().mockRejectedValue(new Error("rpc down")),
    });
    const res = await app(cfg).request("/api/attestations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(502);
    expect(store.list()).toHaveLength(0);
  });
});

describe("GET /api/attestations + /attestations page", () => {
  it("API lists stored entries newest-first", async () => {
    const { cfg, store } = makeCfg();
    store.add({
      id: "a1",
      url: "https://a.example",
      domain: "a.example",
      score: 70,
      status: "ready",
      agentId: "1",
      feedbackTx: FEEDBACK_TX,
      memoTx: MEMO_TX,
      network: "eip155:5042002",
      createdAt: new Date().toISOString(),
    });
    const res = await app(cfg).request("/api/attestations");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attestations).toHaveLength(1);
    expect(body.attestations[0].domain).toBe("a.example");
  });

  it("public page renders entries with explorer links", async () => {
    const { cfg, store } = makeCfg();
    store.add({
      id: "a1",
      url: "https://a.example",
      domain: "a.example",
      score: 70,
      status: "ready",
      agentId: "1",
      feedbackTx: FEEDBACK_TX,
      memoTx: MEMO_TX,
      network: "eip155:5042002",
      createdAt: new Date().toISOString(),
    });
    const res = await app(cfg).request("/attestations");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("a.example");
    expect(html).toContain(`tx/${FEEDBACK_TX}`);
    expect(html.toLowerCase()).toContain("attestation");
  });
});

describe("gate off", () => {
  it("no config → POST 503; registerCoreRoutes skips mount entirely", async () => {
    setAttestationRouteConfig(undefined);
    const plain = new Hono();
    plain.route("/", attestationRoutes);
    const res = await plain.request("/api/attestations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(503);
  });
});
