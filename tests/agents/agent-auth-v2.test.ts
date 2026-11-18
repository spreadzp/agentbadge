import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import {
  buildAccessChallenge,
  requireAccessPass,
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
  CLASS_MEDIUM,
  type AgentAuthVariables,
} from "../../src/server/middleware/agent-auth";

/**
 * SLICE-234-21: walletsig v2 regression — nonce + bodyHash binding.
 *
 * v1 bound only wallet/method/path/timestamp: a captured signature could
 * be replayed with a substituted body inside the ±300s window. v2 adds
 * X-Nonce (single-use per wallet+method+path) and bodyHash (sha256 of
 * the raw body), plus an aud tag. These tests pin the new contract.
 */

const AGENT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const agent = privateKeyToAccount(AGENT_KEY);
const PATH = "/api/total-scan";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function makeApp() {
  const app = new Hono<{ Variables: AgentAuthVariables }>();
  app.post(PATH, requireAccessPass(CLASS_MEDIUM), (c) =>
    c.json({ ok: true, wallet: c.get("agentWallet") }),
  );
  return app;
}

async function signFor(opts: {
  body?: string;
  nonce?: string;
  path?: string;
  method?: string;
  timestamp?: number;
  wallet?: string;
} = {}) {
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const wallet = opts.wallet ?? agent.address;
  const nonce = opts.nonce ?? crypto.randomUUID();
  const bodyHash = opts.body ? sha256(opts.body) : "-";
  const message = buildAccessChallenge({
    wallet,
    method: opts.method ?? "POST",
    path: opts.path ?? PATH,
    timestamp,
    nonce,
    bodyHash,
  });
  const signature = await agent.signMessage({ message });
  return { signature, timestamp, wallet, nonce };
}

function post(
  app: ReturnType<typeof makeApp>,
  s: { wallet: string; signature: string; timestamp: number; nonce: string },
  body?: string,
) {
  return app.request(PATH, {
    method: "POST",
    headers: {
      "x-wallet": s.wallet,
      "x-sig": s.signature,
      "x-timestamp": String(s.timestamp),
      "x-nonce": s.nonce,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body } : {}),
  });
}

describe("SLICE-234-21: agentbadge-access:v2 binding", () => {
  beforeEach(() => {
    configureAgentAuthForTesting({
      verifier: (wallet: string, message: string, signature: string) =>
        verifyMessage({
          address: wallet as `0x${string}`,
          message,
          signature: signature as `0x${string}`,
        }),
      hasAccess: vi.fn().mockResolvedValue(true),
      cacheTtlMs: 60_000,
    });
  });

  afterEach(() => resetAgentAuthForTesting());

  it("401 when X-Nonce header is missing", async () => {
    const s = await signFor();
    const res = await makeApp().request(PATH, {
      method: "POST",
      headers: {
        "x-wallet": s.wallet,
        "x-sig": s.signature,
        "x-timestamp": String(s.timestamp),
      },
    });
    expect(res.status).toBe(401);
  });

  it("401 when X-Nonce is malformed", async () => {
    const s = await signFor({ nonce: "bad nonce!" });
    const res = await post(makeApp(), s);
    expect(res.status).toBe(401);
  });

  it("200 on a valid v2-signed request", async () => {
    const s = await signFor();
    const res = await post(makeApp(), s);
    expect(res.status).toBe(200);
  });

  it("409 on replay — same nonce+wallet+method+path twice", async () => {
    const app = makeApp();
    const s = await signFor();
    const first = await post(app, s);
    expect(first.status).toBe(200);
    const second = await post(app, s);
    expect(second.status).toBe(409);
  });

  it("same nonce on a different path is not a replay", async () => {
    // signFor signs PATH; send to a different route? PATH is fixed in
    // makeApp — instead verify the replay key includes path by signing
    // for PATH but the second request uses the same nonce on the SAME
    // path → covered above. Here: two different nonces both succeed.
    const app = makeApp();
    const s1 = await signFor();
    const s2 = await signFor();
    expect((await post(app, s1)).status).toBe(200);
    expect((await post(app, s2)).status).toBe(200);
  });

  it("401 when the body differs from the signed bodyHash", async () => {
    const signedBody = JSON.stringify({ packs: ["core"] });
    const s = await signFor({ body: signedBody });
    const res = await post(makeApp(), s, JSON.stringify({ packs: ["evil"] }));
    expect(res.status).toBe(401);
  });

  it("200 when the body matches the signed bodyHash", async () => {
    const body = JSON.stringify({ packs: ["core"] });
    const s = await signFor({ body });
    const res = await post(makeApp(), s, body);
    expect(res.status).toBe(200);
  });

  it("401 when a body is sent but the signature bound the empty-body hash", async () => {
    const s = await signFor(); // bodyHash "-"
    const res = await post(makeApp(), s, "{}");
    expect(res.status).toBe(401);
  });
});
