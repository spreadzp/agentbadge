/**
 * SLICE-204-5: risk assessment service — wraps the pure forensics core
 * (@agentbadge/payment-forensics, 204-2) over the 204-3 stores.
 *
 * Verdict mapping (thresholds env-driven — landmine: never hardcode):
 *   thin file                        → "no_data"  (+figures; NOT pass — D-204-5)
 *   organicShare ≥ PASS && no loop   → "pass"
 *   BLOCK ≤ share < PASS             → "caution"
 *   share < BLOCK || self-funded majority → "block"
 *
 * Privacy (AC): this module READS the index only — the caller's address
 * and IP are never persisted.
 */

import {
  analyzeAddress,
  type AddressAnalysis,
  type FundingEvent,
  type PaymentEdge,
  type PublicSource,
  type PublicSourceKind,
} from "@agentbadge/payment-forensics";
import type { ForensicsStores } from "@agentbadge/database";

export type RiskVerdictKind = "pass" | "caution" | "block" | "no_data";

export interface RiskVerdict {
  verdict: RiskVerdictKind;
  reason?: string; // e.g. "forensics_disabled" — honest degraded answer
  organicShare: number;
  grossVolume: string; // USDC atomic, string for JSON safety
  organicVolume: string;
  effectivePayers: number;
  coveredPct: number;
  reasons: string[];
  indexedToBlock: string | null;
  lagBlocks: string | null;
}

export interface AssessDeps {
  stores: ForensicsStores;
  chain: string;
  /** optional live-tip probe; RPC down → lagBlocks=null (honest) */
  getTip?: () => Promise<bigint | null>;
  passShare?: number; // env FORENSICS_PASS_SHARE, default 0.7
  blockShare?: number; // env FORENSICS_BLOCK_SHARE, default 0.3
  sharedFunderMin?: number; // env FORENSICS_SHARED_MIN, default 2
}

const SOURCE_KINDS = new Set([
  "exchange",
  "bridge",
  "custody_provider",
  "contract",
]);

const envShare = (key: string, def: number): number => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : def;
};

function humanize(analysis: AddressAnalysis): string[] {
  const reasons: string[] = [];
  if (analysis.thinFile) {
    reasons.push(
      `thin file: ${analysis.payers.reduce((n, p) => n + 1, 0)} payers, ` +
        `gross ${(Number(analysis.grossVolume) / 1e6).toFixed(2)} USDC`,
    );
    return reasons;
  }
  for (const loop of analysis.loops) {
    reasons.push(
      `payments inside a loop of ${loop.members.length} wallets ` +
        `(internal ${(Number(loop.grossInternal) / 1e6).toFixed(2)} USDC)`,
    );
  }
  for (const p of analysis.payers) {
    if (p.strikeReason === "self_funded") {
      reasons.push(
        p.funder === analysis.address
          ? `payer ${short(p.payer)} funded by this seller`
          : `payer ${short(p.payer)} funded via proxy ${short(p.funder ?? "")}`,
      );
    }
  }
  // shared private funder: group struck payers by funder
  const shared = new Map<string, number>();
  for (const p of analysis.payers) {
    if (p.strikeReason === "shared_funder" && p.funder) {
      shared.set(p.funder, (shared.get(p.funder) ?? 0) + 1);
    }
  }
  for (const [funder, n] of shared) {
    reasons.push(`${n} payers share private funder ${short(funder)}`);
  }
  if (analysis.coveredPct < 1) {
    reasons.push(
      `funding coverage ${(analysis.coveredPct * 100).toFixed(0)}% — ` +
        `verdict uses on-chain data only`,
    );
  }
  return reasons;
}

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a);

export async function assessAddress(
  address: string,
  deps: AssessDeps,
): Promise<RiskVerdict> {
  const { stores, chain } = deps;
  const passShare = deps.passShare ?? envShare("FORENSICS_PASS_SHARE", 0.7);
  const blockShare = deps.blockShare ?? envShare("FORENSICS_BLOCK_SHARE", 0.3);

  const edgeRows = await stores.edges.listBySeller(chain, address);
  const payers = [...new Set(edgeRows.map((r) => r.payer))];
  // Loop detection needs BOTH directions between seller and payers:
  // seller→payer edges (payments back to buyers close loops) plus each
  // payer's other edges. An edge payer→seller appears in BOTH queries —
  // dedupe by natural key or gross is double-counted.
  const seen = new Map<string, PaymentEdge>();
  const put = (r: (typeof edgeRows)[number]) => {
    const e: PaymentEdge = {
      payer: r.payer,
      seller: r.seller,
      amount: r.amountAtomic,
      txHash: r.txHash,
      block: Number(r.blockNumber),
      ts: Number(r.ts),
    };
    seen.set(`${e.txHash}:${e.payer}:${e.seller}:${e.amount}`, e);
  };
  for (const r of edgeRows) put(r);
  const outboundTargets = new Set([address.toLowerCase(), ...payers]);
  for (const p of outboundTargets) {
    for (const r of await stores.edges.listByPayer(chain, p)) put(r);
    for (const r of await stores.edges.listBySeller(chain, p)) put(r);
  }
  const edges = [...seen.values()];

  const funding: FundingEvent[] = [];
  const publicSources: PublicSource[] = [];
  for (const p of payers) {
    const f = await stores.funding.getFirst(chain, p);
    if (!f) continue;
    funding.push({
      funder: f.funder,
      funded: f.funded,
      ts: Number(f.blockNumber), // block ordering is enough for first-funder
      txHash: f.txHash,
    });
    if (f.isPublicSource && f.sourceKind && SOURCE_KINDS.has(f.sourceKind)) {
      publicSources.push({
        address: f.funder,
        kind: f.sourceKind as PublicSourceKind,
      });
    }
  }
  // funding rows keyed by funder also mark OTHER payers' public sources —
  // merge the whole map so shared custodial sources classify correctly.
  const a = analyzeAddress(address, edges, funding, {
    publicSources,
    sharedFunderMin:
      deps.sharedFunderMin ?? Number(process.env.FORENSICS_SHARED_MIN ?? 2),
  });

  const indexedToBlock = await stores.cursor.get(chain);
  let tip: bigint | null = null;
  if (deps.getTip) {
    try {
      tip = await deps.getTip();
    } catch {
      tip = null;
    }
  }
  const lagBlocks =
    indexedToBlock !== null && tip !== null && tip >= indexedToBlock
      ? tip - indexedToBlock
      : null;

  let verdict: RiskVerdictKind;
  if (a.thinFile || edgeRows.length === 0) {
    verdict = "no_data";
  } else if (a.organicShare >= passShare && a.loops.length === 0) {
    verdict = "pass";
  } else {
    // self-funded majority of GROSS volume → hard block (spec: "<0.3 или
    // self-funded majority")
    const selfStruck = a.payers
      .filter((p) => p.strikeReason === "self_funded")
      .reduce((n, p) => n + p.grossVolume, 0n);
    if (a.organicShare < blockShare || selfStruck * 2n > a.grossVolume) {
      verdict = "block";
    } else {
      verdict = "caution";
    }
  }

  return {
    verdict,
    organicShare: a.organicShare,
    grossVolume: a.grossVolume.toString(),
    organicVolume: a.organicVolume.toString(),
    effectivePayers: a.effectivePayers,
    coveredPct: a.coveredPct,
    reasons: humanize(a),
    indexedToBlock: indexedToBlock === null ? null : indexedToBlock.toString(),
    lagBlocks: lagBlocks === null ? null : lagBlocks.toString(),
  };
}

export const NO_DATA_DISABLED: RiskVerdict = {
  verdict: "no_data",
  reason: "forensics_disabled",
  organicShare: 0,
  grossVolume: "0",
  organicVolume: "0",
  effectivePayers: 0,
  coveredPct: 0,
  reasons: ["forensics index disabled"],
  indexedToBlock: null,
  lagBlocks: null,
};
