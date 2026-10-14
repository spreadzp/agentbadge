/**
 * SLICE-185-4 (EPIC-185): opt-in onchain memo-anchoring for witness
 * attestations (D-185-7).
 *
 * After a successful attest we fire-and-forget one Memo call:
 *   memo(witnessWallet, "0x", memoIdFor("witness", attestationId), payloadHash)
 * where attestationId = `${jobId}:${agentId}` (unique — one attestation
 * per witness per job) and payloadHash = keccak256 of the canonical
 * EIP-191 payload the witness signed. The indexed memoId lets a third
 * party prove "witness X attested job Y with this signed statement".
 *
 * target = the enrolled witness wallet — the memo is attributable to
 * the attester, not our sender EOA.
 *
 * Anchoring NEVER blocks the 201: enqueue → background attempts with
 * exponential backoff (WITNESS_ANCHOR_RETRIES, default 3). Status lives
 * in a dedicated JSON store (.data/witness-anchors.json) — attestations
 * are immutable, anchors are mutable state.
 * WITNESS_ANCHOR_ENABLED=0 / no anchorer dep → no memo calls at all.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { encodeFunctionData, keccak256, toBytes } from "viem";
import type { Hex } from "viem";
import { MEMO_ABI, memoIdFor } from "@agentbadge/circle-payments";
import { logger } from "@agentbadge/passport";
import type { WitnessAttestation, WitnessStore } from "./store";
import { buildWitnessPayload } from "./attest";
import type { SendAnchorFn } from "../eaas/anchor";

/** Canonical attestation id — also the witness memo linkage part. */
export function witnessAttestationId(jobId: string, agentId: string): string {
  return `${jobId}:${agentId}`;
}

/** Memo memoId in the "witness" domain (172 memoId namespace discipline). */
export function witnessMemoId(attestationId: string): Hex {
  return memoIdFor("witness", attestationId);
}

/**
 * keccak256 over the signed canonical payload — the anchored context
 * hash. A verifier rebuilds the payload from the public attestation
 * fields (jobId, agentId, verdict, contentSha256, reason) and compares.
 */
export function attestationPayloadHash(att: WitnessAttestation): Hex {
  return keccak256(toBytes(buildWitnessPayload(att)));
}

/* ------------------------------- anchor store ---------------------------- */

export type WitnessAnchorStatus = "pending" | "anchored" | "failed";

export interface WitnessAnchorRecord {
  attestationId: string;
  jobId: string;
  agentId: string;
  memoId: Hex;
  payloadHash: Hex;
  status: WitnessAnchorStatus;
  attempts: number;
  txHash?: Hex;
  blockNumber?: string;
  lastError?: string;
}

export interface WitnessAnchorStore {
  get(attestationId: string): WitnessAnchorRecord | undefined;
  put(r: WitnessAnchorRecord): void;
  patch(attestationId: string, patch: Partial<WitnessAnchorRecord>): void;
  list(): WitnessAnchorRecord[];
}

export function createMemoryWitnessAnchorStore(): WitnessAnchorStore {
  const map = new Map<string, WitnessAnchorRecord>();
  return {
    get: (id) => map.get(id),
    put: (r) => void map.set(r.attestationId, r),
    patch: (id, p) => {
      const r = map.get(id);
      if (r) map.set(id, { ...r, ...p });
    },
    list: () => [...map.values()],
  };
}

export function createJsonWitnessAnchorStore(
  file = join(process.cwd(), ".data", "witness-anchors.json"),
): WitnessAnchorStore {
  const load = (): WitnessAnchorRecord[] => {
    if (!existsSync(file)) return [];
    try {
      return JSON.parse(readFileSync(file, "utf8")) as WitnessAnchorRecord[];
    } catch (e) {
      console.error(
        `witness-anchors: failed to parse ${file}: ${e instanceof Error ? e.message : e}`,
      );
      return [];
    }
  };
  const save = (rows: WitnessAnchorRecord[]) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(rows, null, 2));
  };
  return {
    get: (id) => load().find((r) => r.attestationId === id),
    put: (r) =>
      save([...load().filter((x) => x.attestationId !== r.attestationId), r]),
    patch: (id, p) =>
      save(
        load().map((r) => (r.attestationId === id ? { ...r, ...p } : r)),
      ),
    list: load,
  };
}

/* -------------------------------- anchorer ------------------------------- */

export interface WitnessAnchorerDeps {
  store: WitnessAnchorStore;
  /** Witness store — resumePending reloads attestations per record. */
  attestations: Pick<WitnessStore, "getAttestation">;
  /** Enrolled-wallet lookup for the memo target (attributable anchor). */
  walletFor: (agentId: string) => Promise<`0x${string}` | undefined>;
  /** Memo contract address. */
  memo: `0x${string}`;
  /** Fallback memo target — the sender EOA (self-anchor). */
  selfAddress: `0x${string}`;
  send: SendAnchorFn;
  /** WITNESS_ANCHOR_RETRIES — total attempts before status "failed". */
  retries: number;
  /** Base backoff in ms (exponential: base * 2^attempt). */
  backoffMs: number;
  /** Timer override for tests — default setTimeout. */
  schedule?: (fn: () => void, ms: number) => void;
}

export interface WitnessAnchorer {
  /** Fire-and-forget — safe to call without await after attest persist. */
  enqueue(att: WitnessAttestation): void;
  /** Re-enqueue unfinished anchors (pending/failed) after a restart. */
  resumePending(): void;
}

export function createWitnessAnchorer(
  deps: WitnessAnchorerDeps,
): WitnessAnchorer {
  const schedule =
    deps.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));

  const attempt = async (attestationId: string, att: WitnessAttestation) => {
    const rec = deps.store.get(attestationId);
    if (!rec || rec.status === "anchored") return;
    try {
      const target =
        (await deps.walletFor(att.agentId)) ?? deps.selfAddress;
      const { txHash, blockNumber } = await deps.send({
        to: deps.memo,
        data: encodeFunctionData({
          abi: MEMO_ABI,
          functionName: "memo",
          args: [target, "0x", rec.memoId, rec.payloadHash],
        }),
      });
      deps.store.patch(attestationId, {
        status: "anchored",
        txHash,
        blockNumber: blockNumber.toString(),
        lastError: undefined,
      });
      logger.info("witness attestation anchored", { attestationId, txHash });
    } catch (e) {
      const attempts = rec.attempts + 1;
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn("witness anchor attempt failed", {
        attestationId,
        attempts,
        err: msg,
      });
      deps.store.patch(attestationId, {
        attempts,
        lastError: msg,
        status: attempts >= deps.retries ? "failed" : "pending",
      });
      if (attempts < deps.retries) {
        schedule(
          () => void attempt(attestationId, att),
          deps.backoffMs * 2 ** (attempts - 1),
        );
      }
    }
  };

  return {
    enqueue(att) {
      const attestationId = witnessAttestationId(att.jobId, att.agentId);
      if (deps.store.get(attestationId)?.status === "anchored") return;
      deps.store.put({
        attestationId,
        jobId: att.jobId,
        agentId: att.agentId,
        memoId: witnessMemoId(attestationId),
        payloadHash: attestationPayloadHash(att),
        status: "pending",
        attempts: 0,
      });
      schedule(() => void attempt(attestationId, att), 0);
    },
    resumePending() {
      let n = 0;
      for (const rec of deps.store.list()) {
        if (rec.status === "anchored") continue;
        // Attestations are immutable → re-attempt is idempotent. The
        // record carries jobId+agentId so no attestationId parsing is
        // needed (jobIds may contain ":").
        void deps.attestations
          .getAttestation(rec.jobId, rec.agentId)
          .then((att) => {
            if (!att) return;
            deps.store.patch(rec.attestationId, {
              status: "pending",
              attempts: 0,
            });
            schedule(() => void attempt(rec.attestationId, att), 0);
            n++;
          })
          .catch((e) =>
            logger.warn("witness anchor resume failed", {
              attestationId: rec.attestationId,
              err: e instanceof Error ? e.message : String(e),
            }),
          );
      }
      if (n) logger.info("witness anchorer resumed pending", { count: n });
    },
  };
}
