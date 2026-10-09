/**
 * SLICE-172-3: periodic head-anchor for the verdict hash-chain.
 *
 * Every ARC_CHAIN_FLUSH_MS window (default 24h):
 *   - new entries since the last anchor → anchor the fresh head;
 *   - none → heartbeat: re-anchor the SAME headHash (epochSeq still +1)
 *     so liveness is visible on-chain even in quiet windows.
 *
 * Anchor tx mirrors the 154-4 anchorer path — same SendAnchorFn seam,
 * same fire-and-forget + backoff discipline — but keyed to a different
 * memoId namespace (landmine: never mix namespaces):
 *
 *   memo(target, "0x", memoIdFor("chain", domain, epochSeq),
 *        abiEncode(headHash, count, prevAnchoredHeadHash))
 *
 * Durability: a failed window just retries; the persisted ChainHead
 * keeps the LAST ANCHORED epoch only, so a restart recomputes the same
 * pending epochSeq (same memoId → idempotent on-chain). A missed window
 * (downtime > flushMs) triggers an immediate flush on start().
 */

import { encodeAbiParameters, encodeFunctionData } from "viem";
import type { Hex } from "viem";
import { logger } from "@agentbadge/passport";
import { MEMO_ABI, memoIdFor } from "@agentbadge/circle-payments";
import type { ChainHead } from "@agentbadge/circle-payments";
import type { ChainService, ChainStore } from "./chain";
import type { SendAnchorFn } from "./anchor";
import { GENESIS_HASH } from "@agentbadge/circle-payments";

/** Stored head carries lastAnchoredHash — the headHash of the previous
 *  anchored epoch — so each epoch's memoData can cite its predecessor. */
type FlushedHead = ChainHead & { lastAnchoredHash?: Hex };

export interface ChainFlusherDeps {
  service: Pick<ChainService, "head">;
  /** Head metadata persistence — same store the service writes to. */
  store: Pick<ChainStore, "head" | "putHead">;
  /** Memo contract address. */
  memo: `0x${string}`;
  /** Anchor target — the evaluator EOA (head isn't consumer-bound). */
  selfAddress: `0x${string}`;
  send: SendAnchorFn;
  /** Window length ms (ARC_CHAIN_FLUSH_MS). */
  flushMs: number;
  /** Total send attempts per epoch before giving up (retried next tick). */
  retries: number;
  /** Base backoff ms (exponential: base * 2^attempt). */
  backoffMs: number;
  /** Timer override for tests — default setTimeout. */
  schedule?: (fn: () => void, ms: number) => void;
  /** Clock override for tests. */
  now?: () => number;
}

export interface ChainFlusher {
  /** Begin the window loop + missed-window catch-up. */
  start(): void;
  /** One window check — flush when due (also callable in tests). */
  tick(): void;
}

/** abiEncode(headHash, count, prevAnchoredHeadHash) — memoData payload. */
function headAnchorData(head: ChainHead, prevAnchored: Hex): Hex {
  return encodeAbiParameters(
    [
      { name: "headHash", type: "bytes32" },
      { name: "count", type: "uint256" },
      { name: "prevAnchoredHeadHash", type: "bytes32" },
    ],
    [head.headHash, BigInt(head.count), prevAnchored],
  );
}

export function createChainFlusher(deps: ChainFlusherDeps): ChainFlusher {
  const schedule =
    deps.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const now = deps.now ?? Date.now;

  /** Attempts for the epoch currently in flight (in-memory — restart
   *  recomputes the same epoch from the persisted head). */
  let attempts = 0;
  let flushing = false;

  const attempt = (epochSeq: number) => {
    if (flushing) return;
    // Idempotent: a queued retry or catch-up tick whose epoch already
    // anchored (another path succeeded first) is a no-op.
    const anchored = deps.store.head()?.anchor?.epochSeq;
    if (anchored !== undefined && anchored >= epochSeq) return;
    flushing = true;
    const head = deps.service.head();
    const prev = deps.store.head() as FlushedHead | undefined;
    const prevAnchored = prev?.lastAnchoredHash ?? GENESIS_HASH;
    const memoId = memoIdFor("chain", head.domain, BigInt(epochSeq));
    const data = encodeFunctionData({
      abi: MEMO_ABI,
      functionName: "memo",
      args: [
        deps.selfAddress,
        "0x",
        memoId,
        headAnchorData(head, prevAnchored),
      ],
    });
    void deps
      .send({ to: deps.memo, data })
      .then(({ txHash, blockNumber }) => {
        const flushed: FlushedHead = {
          ...head,
          lastFlushAt: now(),
          anchor: { epochSeq, txHash, blockNumber: blockNumber.toString() },
          lastAnchoredHash: head.headHash,
        };
        deps.store.putHead(flushed);
        logger.info("eaas chain head anchored", {
          domain: head.domain,
          epochSeq,
          count: head.count,
          txHash,
        });
      })
      .catch((e: unknown) => {
        attempts++;
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn("eaas chain flush attempt failed", {
          epochSeq,
          attempts,
          err: msg,
        });
        if (attempts < deps.retries) {
          schedule(
            () => attempt(epochSeq),
            deps.backoffMs * 2 ** (attempts - 1),
          );
        }
      })
      .finally(() => {
        flushing = false;
      });
  };

  return {
    start() {
      const last = deps.store.head()?.lastFlushAt ?? 0;
      const due = now() - last >= deps.flushMs;
      schedule(() => this.tick(), due ? 0 : deps.flushMs - (now() - last));
    },
    tick() {
      const head = deps.store.head();
      const last = head?.lastFlushAt ?? 0;
      if (now() - last >= deps.flushMs || head?.anchor === undefined) {
        attempts = 0;
        attempt((head?.anchor?.epochSeq ?? -1) + 1);
      }
      // Reschedule the next window from NOW, not from lastFlushAt — keeps
      // windows regular even when a flush attempt spans part of one.
      schedule(() => this.tick(), deps.flushMs);
    },
  };
}
