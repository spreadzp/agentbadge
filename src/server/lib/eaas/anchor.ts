/**
 * SLICE-154-4: onchain memo-anchoring for VerdictArtifacts.
 *
 * After a verdict is signed we fire-and-forget one Memo call:
 *   memo(target, "0x", memoIdFor("eaas", verdictId), artifactHash)
 * where artifactHash = keccak256(canonical artifact JSON incl. signature).
 * The Memo event (indexed memoId) gives any third party an onchain proof
 * of "what was signed, when" — a diff vs plain SaaS APIs.
 *
 * target = consumerWallet when known, else the anchor sender EOA —
 * a self-anchor, since calling the memo contract itself with empty
 * calldata may revert.
 *
 * Anchoring never blocks the API response: enqueue → background attempts
 * with exponential backoff (ARC_EAAS_ANCHOR_RETRIES, default 3).
 * Status lives in a separate JSON store (the verdict store's put() is
 * intentionally idempotent — anchors are mutable state).
 * ARC_EAAS_MEMO_ANCHOR=0 disables anchoring entirely (anchor absent).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { encodeFunctionData } from "viem";
import type { Hex } from "viem";
import { MEMO_ABI, memoIdFor } from "@agentbadge/circle-payments";
import { logger } from "@agentbadge/passport";
import type { StoredVerdict } from "./store";
import { hashCanonical, type VerdictArtifact } from "./verdict";

/** keccak256 over the canonical signed artifact — onchain context hash. */
export function artifactHashOf(artifact: VerdictArtifact): Hex {
  return hashCanonical(artifact);
}

/** Memo memoId namespace for verdict anchors (distinct from eaas-eval feedback). */
export function verdictMemoId(verdictId: string): Hex {
  return memoIdFor("eaas", verdictId);
}

/* ------------------------------- anchor store ---------------------------- */

export type AnchorStatus = "pending" | "anchored" | "failed";

export interface AnchorRecord {
  verdictId: Hex;
  memoId: Hex;
  artifactHash: Hex;
  status: AnchorStatus;
  attempts: number;
  txHash?: Hex;
  blockNumber?: string;
  lastError?: string;
}

export interface AnchorStore {
  get(verdictId: Hex): AnchorRecord | undefined;
  put(r: AnchorRecord): void;
  /** merge patch — the only mutable update path. */
  patch(verdictId: Hex, patch: Partial<AnchorRecord>): void;
  list(): AnchorRecord[];
}

export function createJsonAnchorStore(
  file = ".data/eaas-anchors.json",
): AnchorStore {
  const load = (): AnchorRecord[] => {
    if (!existsSync(file)) return [];
    try {
      return JSON.parse(readFileSync(file, "utf8")) as AnchorRecord[];
    } catch {
      return [];
    }
  };
  const save = (rows: AnchorRecord[]) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(rows, null, 2));
  };
  return {
    get: (id) => load().find((r) => r.verdictId === id),
    put: (r) => save([...load().filter((x) => x.verdictId !== r.verdictId), r]),
    patch: (id, patch) =>
      save(load().map((r) => (r.verdictId === id ? { ...r, ...patch } : r))),
    list: load,
  };
}

export function createMemoryAnchorStore(): AnchorStore {
  const map = new Map<Hex, AnchorRecord>();
  return {
    get: (id) => map.get(id),
    put: (r) => void map.set(r.verdictId, r),
    patch: (id, p) => {
      const r = map.get(id);
      if (r) map.set(id, { ...r, ...p });
    },
    list: () => [...map.values()],
  };
}

/* -------------------------------- anchorer ------------------------------- */

/** Outcome of the memo send — tx + confirmed block for the record. */
export interface AnchorSendResult {
  txHash: Hex;
  blockNumber: bigint;
}

export type SendAnchorFn = (tx: {
  to: `0x${string}`;
  data: Hex;
}) => Promise<AnchorSendResult>;

export interface AnchorerDeps {
  store: AnchorStore;
  /** Verdict store — resumePending reloads the StoredVerdict body per row. */
  verdicts: { get(verdictId: Hex): StoredVerdict | undefined };
  /** Memo contract address. */
  memo: `0x${string}`;
  /** Self-anchor fallback target — the sender EOA. */
  selfAddress: `0x${string}`;
  send: SendAnchorFn;
  /** ARC_EAAS_ANCHOR_RETRIES — total attempts before status "failed". */
  retries: number;
  /** Base backoff in ms (exponential: base * 2^attempt). */
  backoffMs: number;
  /** Timer override for tests — default setTimeout. */
  schedule?: (fn: () => void, ms: number) => void;
}

export interface VerdictAnchorer {
  /** Fire-and-forget — safe to call without await after verdict persist. */
  enqueue(stored: StoredVerdict): void;
  /** Re-enqueue unfinished anchors (pending/failed) after a restart. */
  resumePending(): void;
}

function anchorTxData(
  deps: AnchorerDeps,
  stored: StoredVerdict,
  memoId: Hex,
  artifactHash: Hex,
): { to: `0x${string}`; data: Hex } {
  const target = (stored.consumerWallet ?? deps.selfAddress) as `0x${string}`;
  return {
    to: deps.memo,
    data: encodeFunctionData({
      abi: MEMO_ABI,
      functionName: "memo",
      args: [target, "0x", memoId, artifactHash],
    }),
  };
}

export function createAnchorer(deps: AnchorerDeps): VerdictAnchorer {
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));

  const attempt = async (verdictId: Hex, stored: StoredVerdict) => {
    const rec = deps.store.get(verdictId);
    if (!rec || rec.status === "anchored") return;
    try {
      const { txHash, blockNumber } = await deps.send(
        anchorTxData(deps, stored, rec.memoId, rec.artifactHash),
      );
      deps.store.patch(verdictId, {
        status: "anchored",
        txHash,
        blockNumber: blockNumber.toString(),
        lastError: undefined,
      });
      logger.info("eaas verdict anchored", { verdictId, txHash });
    } catch (e) {
      const attempts = rec.attempts + 1;
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn("eaas anchor attempt failed", { verdictId, attempts, err: msg });
      deps.store.patch(verdictId, {
        attempts,
        lastError: msg,
        status: attempts >= deps.retries ? "failed" : "pending",
      });
      if (attempts < deps.retries) {
        schedule(() => void attempt(verdictId, stored), deps.backoffMs * 2 ** (attempts - 1));
      }
    }
  };

  return {
    enqueue(stored) {
      const verdictId = stored.artifact.verdictId;
      if (deps.store.get(verdictId)?.status === "anchored") return;
      const memoId = verdictMemoId(verdictId);
      deps.store.put({
        verdictId,
        memoId,
        artifactHash: artifactHashOf(stored.artifact),
        status: "pending",
        attempts: 0,
      });
      schedule(() => void attempt(verdictId, stored), 0);
    },
    resumePending() {
      // After a restart: pending/failed rows get one more shot at the same
      // artifact (verdicts are immutable → re-attempt is idempotent).
      let n = 0;
      for (const rec of deps.store.list()) {
        if (rec.status === "anchored") continue;
        const stored = deps.verdicts.get(rec.verdictId);
        if (!stored) continue;
        // failed rows already exhausted attempts — reset for a fresh run.
        deps.store.patch(rec.verdictId, {
          status: "pending",
          attempts: 0,
        });
        schedule(() => void attempt(rec.verdictId, stored), 0);
        n++;
      }
      if (n) logger.info("eaas anchorer resumed pending", { count: n });
    },
  };
}

/* ------------------------------ verify lookup ----------------------------- */

/** Onchain memo hit — event fields needed by the public verify endpoint. */
export interface AnchorLookupResult {
  txHash: Hex;
  blockNumber: bigint;
  /** Memo event `memo` bytes — must equal AnchorRecord.artifactHash. */
  memoData: Hex;
  blockTime?: number;
}

export type FindAnchorFn = (
  memoId: Hex,
) => Promise<AnchorLookupResult | null>;

export interface AnchorVerifyResult {
  signatureValid: boolean;
  signer: Hex;
  chainId: number;
  anchor: {
    status: AnchorStatus | "none";
    found: boolean;
    memoId?: Hex;
    txHash?: Hex;
    contextMatches: boolean;
    blockTime?: number;
  };
}
