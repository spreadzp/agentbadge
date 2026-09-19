import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import {
  recoverMessageAddress,
  parseErc6492Signature,
  serializeErc6492Signature,
} from "viem";
import {
  buildAccessChallenge,
  requireAccessPass,
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
  CLASS_MEDIUM,
  CLASS_HEAVY,
  CLASS_FULL,
  type AgentAuthVariables,
} from "../../src/server/middleware/agent-auth";
import {
  createMintOnSettleHook,
  configureAccessPassMinterForTesting,
  resetAccessPassMinterForTesting,
  type MintRequest,
} from "../../src/server/lib/access-pass-minter";

/**
 * SLICE-137-6: server e2e — pay → mint → signed call → 200.
 *
 * Full loop through both seams: the x402 afterSettle hook writes to an
 * in-memory pass store (standing in for AccessPassNFT on Arc), then
 * requireAccessPass reads it back. Signature verification is REAL for
 * EOA (local ecrecover) and emulates ERC-1271/6492 for contract wallets
 * (on-chain proof lives in contracts/test/AccessPassNFT.e2e.test.ts —
 * same viem verifyMessage path the production verifier uses).
 */

const AGENT_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const OTHER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const agent = privateKeyToAccount(AGENT_KEY);
const aaOwner = privateKeyToAccount(OTHER_KEY);

const PATH = "/api/total-scan";

// ─── In-memory AccessPassNFT stand-in ──────────────────────────
interface Pass {
  mask: number;
  expiresAtSec: number;
  revoked: boolean;
  agentId: bigint;
}
const passes = new Map<string, Pass>(); // key: `${wallet}:${tokenId}` — one pass per wallet+class row
const passIndex = new Map<string, bigint>(); // `${wallet}:${cls}` → tokenId
let nextTokenId = 1n;

function key(wallet: string, cls: number) {
  return `${wallet.toLowerCase()}:${cls}`;
}

/** Mirrors contract semantics: one pass per wallet+class, additive renewal. */
async function storeMint(req: MintRequest): Promise<string> {
  const k = key(req.to, req.classMask);
  let tokenId = passIndex.get(k);
  const now = Math.floor(Date.now() / 1000);
  if (tokenId === undefined) {
    tokenId = nextTokenId++;
    passIndex.set(k, tokenId);
    passes.set(`${req.to.toLowerCase()}:${tokenId}`, {
      mask: req.classMask,
      expiresAtSec: now + req.durationSec,
      revoked: false,
      agentId: req.agentId,
    });
  } else {
    const p = passes.get(`${req.to.toLowerCase()}:${tokenId}`)!;
    p.expiresAtSec = Math.max(p.expiresAtSec, now) + req.durationSec;
    p.mask |= req.classMask;
  }
  return `0xmint${tokenId.toString(16)}`;
}

async function storeHasAccess(wallet: string, cls: number): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  for (const [k, tokenId] of passIndex) {
    if (!k.startsWith(wallet.toLowerCase() + ":")) continue;
    const p = passes.get(`${wallet.toLowerCase()}:${tokenId}`)!;
    if (p.revoked) continue;
    if (p.expiresAtSec <= now) continue;
    if (p.mask & cls || p.mask & CLASS_FULL) return true;
  }
  return false;
}

// ─── Verifier: real ecrecover for EOA; emulated 1271/6492 for AA ─
const aaOwners = new Map<string, string>(); // contract wallet → owner EOA

async function testVerifier(
  wallet: string,
  message: string,
  signature: string,
): Promise<boolean> {
  try {
    // ERC-6492 wrapped sig → unwrap to inner signature
    let sig = signature as `0x${string}`;
    if (sig.endsWith("6492649264926492649264926492649264926492649264926492649264926492" as never)) {
      sig = parseErc6492Signature(sig).signature;
    }
    const recovered = await recoverMessageAddress({ message, signature: sig });
    const owner = aaOwners.get(wallet.toLowerCase());
    // Contract wallet: owner sig counts (ERC-1271 emulation);
    // EOA: sig must recover to the wallet itself
    const expected = owner ?? wallet;
    return recovered.toLowerCase() === expected.toLowerCase();
  } catch {
    return false;
  }
}

// ─── App + helpers ─────────────────────────────────────────────
function makeApp() {
  const app = new Hono<{ Variables: AgentAuthVariables }>();
  app.post(PATH, requireAccessPass(CLASS_MEDIUM), (c) =>
    c.json({ ok: true, wallet: c.get("agentWallet") }),
  );
  app.post("/api/heavy", requireAccessPass(CLASS_HEAVY), (c) =>
    c.json({ ok: true }),
  );
  return app;
}

async function signedPost(
  app: ReturnType<typeof makeApp>,
  opts: {
    signer: typeof agent;
    wallet?: string;
    path?: string;
    timestamp?: number;
    wrap6492?: { factory: string; data: `0x${string}` };
  },
) {
  const path = opts.path ?? PATH;
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const wallet = opts.wallet ?? opts.signer.address;
  const message = buildAccessChallenge({
    wallet,
    method: "POST",
    path,
    timestamp,
  });
  let signature = await opts.signer.signMessage({ message });
  if (opts.wrap6492) {
    signature = serializeErc6492Signature({
      address: opts.wrap6492.factory as `0x${string}`,
      data: opts.wrap6492.data,
      signature: signature as `0x${string}`,
    });
  }
  return app.request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Wallet": wallet,
      "X-Sig": signature,
      "X-Timestamp": String(timestamp),
    },
    body: "{}",
  });
}

function settleCtx(payer: string, opts: { amount?: string; packs?: string[] } = {}) {
  return {
    result: {
      success: true,
      payer,
      amount: opts.amount ?? "800000", // $0.80 → 1 day medium
      transaction: "0xpaytx",
    },
    requirements: { amount: opts.amount ?? "800000" },
    paymentPayload: {},
    declaredExtensions: {},
    phase: "afterHandler",
    transportContext: {
      request: {
        adapter: { getBody: async () => ({ packs: opts.packs ?? ["openapi-docs"] }) },
      },
    },
  } as never;
}

beforeEach(() => {
  passes.clear();
  passIndex.clear();
  aaOwners.clear();
  nextTokenId = 1n;
  configureAgentAuthForTesting({
    verifier: testVerifier,
    hasAccess: storeHasAccess,
  });
  configureAccessPassMinterForTesting({ minter: storeMint });
});

afterEach(() => {
  resetAgentAuthForTesting();
  resetAccessPassMinterForTesting();
});

describe("SLICE-137-6 e2e: pay → mint → signed call", () => {
  it("EOA: settle → mint → signed POST → 200", async () => {
    const app = makeApp();
    await createMintOnSettleHook()(settleCtx(agent.address));

    const res = await signedPost(app, { signer: agent });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.wallet).toBe(agent.address.toLowerCase());
  });

  it("AA (ERC-1271): mint to contract wallet → owner sig → 200", async () => {
    const app = makeApp();
    const contractWallet = "0x150541B28C37bbcE4bE8fDeF4fB77f42B486f00e";
    aaOwners.set(contractWallet.toLowerCase(), aaOwner.address);

    // Payer IS the contract wallet (tx.from in settle result)
    await createMintOnSettleHook()(settleCtx(contractWallet));

    const res = await signedPost(app, {
      signer: aaOwner,
      wallet: contractWallet,
    });
    expect(res.status).toBe(200);
  });

  it("ERC-6492: counterfactual wallet sig → 200", async () => {
    const app = makeApp();
    const counterfactual = "0x9cA70B93CaE5576645F5F069524A9B9c3aef5006";
    aaOwners.set(counterfactual.toLowerCase(), aaOwner.address);
    await createMintOnSettleHook()(settleCtx(counterfactual));

    const res = await signedPost(app, {
      signer: aaOwner,
      wallet: counterfactual,
      wrap6492: {
        factory: "0x0000000000000000000000000000000000000001",
        data: "0xdeadbeef",
      },
    });
    expect(res.status).toBe(200);
  });

  it("renewal: second settle extends pass → still 200", async () => {
    const app = makeApp();
    const hook = createMintOnSettleHook();
    await hook(settleCtx(agent.address));
    await hook(settleCtx(agent.address)); // renewal

    const tokenId = passIndex.get(key(agent.address, CLASS_MEDIUM))!;
    const p = passes.get(`${agent.address.toLowerCase()}:${tokenId}`)!;
    const now = Math.floor(Date.now() / 1000);
    expect(p.expiresAtSec).toBeGreaterThanOrEqual(now + 2 * 86400 - 5);

    const res = await signedPost(app, { signer: agent });
    expect(res.status).toBe(200);
  });

  it("agentId stored on mint", async () => {
    const hook = createMintOnSettleHook();
    await hook(settleCtx(agent.address));
    const tokenId = passIndex.get(key(agent.address, CLASS_MEDIUM))!;
    expect(passes.get(`${agent.address.toLowerCase()}:${tokenId}`)!.agentId).toBe(0n);
  });
});

describe("SLICE-137-6 e2e: negatives", () => {
  it("expired pass → 402", async () => {
    const app = makeApp();
    const tokenId = nextTokenId++;
    passIndex.set(key(agent.address, CLASS_MEDIUM), tokenId);
    passes.set(`${agent.address.toLowerCase()}:${tokenId}`, {
      mask: CLASS_MEDIUM,
      expiresAtSec: Math.floor(Date.now() / 1000) - 60, // expired
      revoked: false,
      agentId: 0n,
    });
    const res = await signedPost(app, { signer: agent });
    expect(res.status).toBe(402);
  });

  it("revoked pass → 402", async () => {
    const app = makeApp();
    const tokenId = nextTokenId++;
    passIndex.set(key(agent.address, CLASS_MEDIUM), tokenId);
    passes.set(`${agent.address.toLowerCase()}:${tokenId}`, {
      mask: CLASS_MEDIUM,
      expiresAtSec: Math.floor(Date.now() / 1000) + 86400,
      revoked: true,
      agentId: 0n,
    });
    const res = await signedPost(app, { signer: agent });
    expect(res.status).toBe(402);
  });

  it("wrong class: medium pass, heavy route → 402", async () => {
    const app = makeApp();
    await createMintOnSettleHook()(settleCtx(agent.address)); // medium pass
    const res = await signedPost(app, { signer: agent, path: "/api/heavy" });
    expect(res.status).toBe(402);
  });

  it("forged sig (wrong signer) → 401", async () => {
    const app = makeApp();
    await createMintOnSettleHook()(settleCtx(agent.address));
    const res = await signedPost(app, {
      signer: aaOwner, // signs but claims agent's wallet
      wallet: agent.address,
    });
    expect(res.status).toBe(401);
  });

  it("stale timestamp (>300s) → 401", async () => {
    const app = makeApp();
    await createMintOnSettleHook()(settleCtx(agent.address));
    const res = await signedPost(app, {
      signer: agent,
      timestamp: Math.floor(Date.now() / 1000) - 400,
    });
    expect(res.status).toBe(401);
  });

  it("no pass at all → 402", async () => {
    const app = makeApp();
    const res = await signedPost(app, { signer: agent });
    expect(res.status).toBe(402);
  });
});
