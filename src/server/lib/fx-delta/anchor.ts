/**
 * SLICE-191-9: Arc anchoring — DeltaAlert verdicts on AgentEventLog.
 *
 * Dominant is verification (D-191-11): every threshold crossing mints a
 * hash-verdict on Arc so a feed buyer can prove "feed is not painted".
 * Money on Celo, proofs on Arc.
 *
 * Flow: engine transition → canonical verdict JSON → sha256 →
 * emitTopic("fxdelta-verdict", payload) on AgentEventLog
 * (0x1bb6A87D18cbd4285b4d383F88f10a1Ed01B4700, testnet). Anchor is
 * ASYNC — a dead Arc RPC never blocks or kills the feed: the alert
 * ships, the queue retries until anchored (AC3).
 */

import { createHash } from "node:crypto";
import { keccak256, stringToBytes } from "viem";
import type { FxDeltaView } from "./index";

export const FXDELTA_ANCHOR_TOPIC = "fxdelta-verdict";

/** Canonical verdict — fixed key order, no whitespace. */
export interface FxDeltaVerdict {
  corridor: string;
  deltaPct: number | null;
  onchainPrice: number | null;
  fxRef: number | null;
  phase: string;
  thin: boolean;
  tsMs: number;
}

export function verdictOf(v: FxDeltaView): FxDeltaVerdict {
  return {
    corridor: v.corridor,
    deltaPct: v.deltaPct,
    onchainPrice: v.chainRate,
    fxRef: v.fxRefRate,
    phase: v.phase,
    thin: v.thin,
    tsMs: v.lastUpdateMs,
  };
}

/** Canonical JSON — keys in struct order, deterministic. */
export function verdictCanonical(v: FxDeltaVerdict): string {
  return JSON.stringify(v, Object.keys(v).sort());
}

/** sha256(canonical) hex — the externally checkable commitment. */
export function verdictHash(v: FxDeltaVerdict): string {
  return createHash("sha256")
    .update(verdictCanonical(v), "utf8")
    .digest("hex");
}

export type AnchorStatus = "pending" | "anchored" | "dead";

export interface AnchorRecord {
  id: string; // "fxd-<hash16>-<tsMs>"
  hash: string;
  verdict: FxDeltaVerdict;
  status: AnchorStatus;
  attempts: number;
  txHash?: string;
  lastError?: string;
  enqueuedAtMs: number;
}

/** Injectable chain writer — production emits emitTopic on Arc. */
export type AnchorWriter = (payloadJson: string) => Promise<string>;

export interface AnchorQueueOptions {
  writer: AnchorWriter;
  retryMs?: number; // default 30s
  maxAttempts?: number; // default 20 → dead
  now?: () => number;
}

export class AnchorQueue {
  private readonly records = new Map<string, AnchorRecord>();
  private readonly cfg;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: AnchorQueueOptions) {
    this.cfg = {
      writer: opts.writer,
      retryMs: opts.retryMs ?? 30_000,
      maxAttempts: opts.maxAttempts ?? 20,
      now: opts.now ?? Date.now,
    };
  }

  enqueue(verdict: FxDeltaVerdict): AnchorRecord {
    const hash = verdictHash(verdict);
    const id = `fxd-${hash.slice(0, 16)}-${verdict.tsMs}`;
    const existing = this.records.get(id);
    if (existing) return existing; // dedup same verdict
    const rec: AnchorRecord = {
      id,
      hash,
      verdict,
      status: "pending",
      attempts: 0,
      enqueuedAtMs: this.cfg.now(),
    };
    this.records.set(id, rec);
    void this.flush(); // fire-and-forget — never block the caller
    return rec;
  }

  /** Drain pending records; failures reschedule (next flush). */
  async flush(): Promise<void> {
    for (const rec of this.records.values()) {
      if (rec.status !== "pending") continue;
      if (rec.attempts >= this.cfg.maxAttempts) {
        rec.status = "dead";
        continue;
      }
      rec.attempts++;
      try {
        rec.txHash = await this.cfg.writer(verdictCanonical(rec.verdict));
        rec.status = "anchored";
      } catch (e) {
        rec.lastError = e instanceof Error ? e.message : String(e);
      }
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.cfg.retryMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get(id: string): AnchorRecord | undefined {
    return this.records.get(id);
  }

  latestFor(corridor: string): AnchorRecord | undefined {
    let best: AnchorRecord | undefined;
    for (const r of this.records.values()) {
      if (
        r.verdict.corridor === corridor &&
        (!best || r.enqueuedAtMs > best.enqueuedAtMs)
      ) {
        best = r;
      }
    }
    return best;
  }

  list(): AnchorRecord[] {
    return [...this.records.values()];
  }

  size(): number {
    return this.records.size;
  }
}

/**
 * Alert-transition watcher: poll engine views, enqueue a verdict when a
 * corridor flips inAlert false→true (hysteresis crossing).
 */
export function createAlertAnchor(
  engine: { getAll(): FxDeltaView[] },
  queue: AnchorQueue,
): { tick(): AnchorRecord[] } {
  const prev = new Map<string, boolean>();
  return {
    tick() {
      const out: AnchorRecord[] = [];
      for (const v of engine.getAll()) {
        const was = prev.get(v.corridor) ?? false;
        prev.set(v.corridor, v.inAlert);
        if (v.inAlert && !was) out.push(queue.enqueue(verdictOf(v)));
      }
      return out;
    },
  };
}

/** bytes32 commitment for compact payloads (keccak of canonical). */
export function verdictBytes32(v: FxDeltaVerdict): `0x${string}` {
  return keccak256(stringToBytes(verdictCanonical(v)));
}
