import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  InMemoryForensicsCursorStore,
  InMemoryForensicsEdgeStore,
  InMemoryForensicsFundingStore,
} from "@agentbadge/database";
import { assessAddress } from "../src/server/lib/forensics/risk-service";
import { riskRoutes } from "../src/server/routes/risk-api";

const CHAIN = "5042";
const SELLER = "0x0000000000000000000000000000000000000a01";
const P1 = "0x00000000000000000000000000000000000000b1";
const P2 = "0x00000000000000000000000000000000000000b2";
const EXT = "0x00000000000000000000000000000000000000e9";

const mkStores = () => ({
  edges: new InMemoryForensicsEdgeStore(),
  funding: new InMemoryForensicsFundingStore(),
  cursor: new InMemoryForensicsCursorStore(),
});

const edge = (
  payer: string,
  seller: string,
  amount: bigint,
  bn: bigint,
  tx: string,
) =>
  ({
    chain: CHAIN,
    payer,
    seller,
    amountAtomic: amount,
    txHash: tx,
    blockNumber: bn,
    source: "chain",
    ts: 0n,
  }) as const;

const deps = (stores: ReturnType<typeof mkStores>) => ({
  stores,
  chain: CHAIN,
  getTip: async () => 1_000n,
});

afterEach(() => {
  delete process.env.FORENSICS_ENABLED;
});

describe("assessAddress — verdict scenarios", () => {
  it("clean organic → pass", async () => {
    const s = mkStores();
    for (let i = 0; i < 3; i++) {
      await s.edges.append(edge(P1, SELLER, 1_000_000n, BigInt(100 + i), `0xp1_${i}`));
      await s.edges.append(edge(P2, SELLER, 1_000_000n, BigInt(110 + i), `0xp2_${i}`));
    }
    await s.cursor.set(CHAIN, 900n);
    const v = await assessAddress(SELLER, deps(s));
    expect(v.verdict).toBe("pass");
    expect(v.organicShare).toBe(1);
    expect(v.coveredPct).toBe(0); // funding unknown — honest in response
    expect(v.indexedToBlock).toBe("900");
    expect(v.lagBlocks).toBe("100"); // tip 1000 − indexed 900
  });

  it("seller pays payer back (loop, net inflow <30%) → block", async () => {
    const s = mkStores();
    // P1 pays seller 8×1 USDC; seller returns 7.5 → net ~0.5 organic.
    // P2 adds 1 organic USDC so payerCount≥2 (not thin). 1.5/9 < 0.3 → block.
    for (let i = 0; i < 8; i++) {
      await s.edges.append(edge(P1, SELLER, 1_000_000n, BigInt(100 + i), `0xps_${i}`));
    }
    for (let i = 0; i < 5; i++) {
      await s.edges.append(edge(SELLER, P1, 1_500_000n, BigInt(200 + i), `0xsp_${i}`));
    }
    await s.edges.append(edge(P2, SELLER, 1_000_000n, 300n, "0xp2_0"));
    const v = await assessAddress(SELLER, deps(s));
    expect(v.verdict).toBe("block");
    expect(v.organicShare).toBeLessThan(0.3);
    expect(v.reasons.join(" ")).toMatch(/loop/i);
  });

  it("self-funded majority → block", async () => {
    const s = mkStores();
    // P1 (seller-funded) pays 5 USDC, P2 pays 4 → struck volume 5 > 9/2 → block.
    for (let i = 0; i < 5; i++) {
      await s.edges.append(edge(P1, SELLER, 1_000_000n, BigInt(100 + i), `0xsf_${i}`));
    }
    for (let i = 0; i < 4; i++) {
      await s.edges.append(edge(P2, SELLER, 1_000_000n, BigInt(110 + i), `0xn_${i}`));
    }
    // seller funded this payer directly — the money came back as "revenue"
    await s.funding.insertFirst({
      chain: CHAIN,
      funded: P1,
      funder: SELLER,
      txHash: "0xfund",
      blockNumber: 50n,
      isPublicSource: false,
    });
    const v = await assessAddress(SELLER, deps(s));
    expect(v.verdict).toBe("block");
    expect(v.reasons.join(" ")).toMatch(/funded by this seller/i);
  });

  it("thin file (1 settle) → no_data with figures — NOT pass (D-204-5)", async () => {
    const s = mkStores();
    await s.edges.append(edge(P1, SELLER, 10_000n, 100n, "0xthin"));
    const v = await assessAddress(SELLER, deps(s));
    expect(v.verdict).toBe("no_data");
    expect(v.reasons.join(" ")).toMatch(/thin file/i);
  });

  it("no edges at all → no_data", async () => {
    const s = mkStores();
    const v = await assessAddress(SELLER, deps(s));
    expect(v.verdict).toBe("no_data");
  });

  it("public-source funder does not strike (custody_provider)", async () => {
    const s = mkStores();
    const p3 = "0x00000000000000000000000000000000000000b3";
    for (const p of [P1, P2, p3]) {
      for (let i = 0; i < 2; i++) {
        await s.edges.append(edge(p, SELLER, 1_000_000n, BigInt(100 + i), `0xpub_${p.slice(-2)}_${i}`));
      }
      await s.funding.insertFirst({
        chain: CHAIN, funded: p, funder: EXT, txHash: `0xf_${p.slice(-2)}`,
        blockNumber: 50n, isPublicSource: true, sourceKind: "custody_provider",
      });
    }
    const v = await assessAddress(SELLER, deps(s));
    expect(v.verdict).toBe("pass");
    expect(v.coveredPct).toBe(1);
  });
});

describe("GET /api/v1/risk/:address", () => {
  const app = new Hono().route("/", riskRoutes);

  it("bad address → 400 before any work", async () => {
    const res = await app.request("/api/v1/risk/not-an-address");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("bad_address");
    expect(body.verdict).toBe("no_data");
  });

  it("FORENSICS_ENABLED=off → honest no_data + reason (not 500)", async () => {
    process.env.FORENSICS_ENABLED = "false";
    const res = await app.request(`/api/v1/risk/${SELLER}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verdict).toBe("no_data");
    expect(body.reason).toBe("forensics_disabled");
  });
});
