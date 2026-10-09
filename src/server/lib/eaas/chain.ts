/**
 * SLICE-172-2: domain-keyed verdict hash-chain — server-side store +
 * append service. Every persisted verdict links its artifactHash into a
 * linear chain ("eaas-verdicts") so a third party can replay
 * `verifyChain` offline and compare the head against the periodic
 * on-chain head anchor (172-3).
 *
 * Primitives (linking rule, verify, inclusion) live in
 * `@agentbadge/circle-payments/chain` — this module adds persistence and
 * the issueVerdict hook:
 *
 *   store.put(stored)          // verdict persisted
 *   chain.append(stored)       // exactly-once per verdictId
 *
 * Tamper model: entries file is append-only; edit/delete/insert anywhere
 * breaks `verifyChain` at the first divergence.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Hex } from "viem";
import {
  appendEntry,
  chainHeadOf,
  inclusionPath,
  verifyChain,
  type ChainEntry,
  type ChainHead,
  type ChainVerifyResult,
} from "@agentbadge/circle-payments";
import type { StoredVerdict } from "./store";
import { artifactHashOf } from "./anchor";

export const VERDICT_CHAIN_DOMAIN = "eaas-verdicts";

/* ------------------------------- chain store ---------------------------- */

export interface ChainStore {
  /** Ordered entry list (seq order). */
  list(): ChainEntry[];
  /** verdictId already appended? */
  has(verdictId: Hex): boolean;
  /** Persist an appended entry (single-writer; issueVerdict serializes). */
  append(e: ChainEntry): void;
  /** Persisted head metadata (anchor fields filled by 172-3). */
  head(): ChainHead | undefined;
  putHead(h: ChainHead): void;
}

interface ChainFile {
  domain: string;
  entries: ChainEntry[];
  head?: ChainHead;
}

export function createJsonChainStore(
  file = ".data/eaas-chain.json",
  domain = VERDICT_CHAIN_DOMAIN,
): ChainStore {
  const load = (): ChainFile => {
    if (!existsSync(file)) return { domain, entries: [] };
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as ChainFile;
      return { domain, entries: parsed.entries ?? [], head: parsed.head };
    } catch {
      return { domain, entries: [] };
    }
  };
  const save = (f: ChainFile) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(f, null, 2));
  };
  return {
    list: () => load().entries,
    has: (id) => load().entries.some((e) => e.verdictId === id),
    append: (e) => {
      const f = load();
      f.entries.push(e);
      // Spread order matters: keep flush/anchor metadata (172-3) while
      // refreshing headHash+count from the entry list.
      f.head = { ...f.head, ...chainHeadOf(domain, f.entries) };
      save(f);
    },
    head: () => load().head,
    putHead: (h) => {
      const f = load();
      f.head = h;
      save(f);
    },
  };
}

export function createMemoryChainStore(
  domain = VERDICT_CHAIN_DOMAIN,
): ChainStore {
  const entries: ChainEntry[] = [];
  let head: ChainHead | undefined;
  return {
    list: () => [...entries],
    has: (id) => entries.some((e) => e.verdictId === id),
    append: (e) => {
      entries.push(e);
      head = { ...head, ...chainHeadOf(domain, entries) };
    },
    head: () => head,
    putHead: (h) => {
      head = h;
    },
  };
}

/* ------------------------------ chain service --------------------------- */

export interface ChainService {
  /**
   * Link a persisted verdict into the chain — exactly-once per
   * verdictId (duplicate issueVerdict replays and store retries both
   * no-op). Returns the new entry, or the existing one when idempotent-
   * skipped.
   */
  append(stored: StoredVerdict): ChainEntry;
  head(): ChainHead;
  /** Entries in [from, to] seq range (to exclusive, default = head). */
  entries(from?: number, to?: number): ChainEntry[];
  /**
   * Inclusion proof for one verdict: its entry plus the suffix to head —
   * sufficient for offline recomputation of `headHash`.
   */
  proofFor(
    verdictId: Hex,
  ): { entry: ChainEntry; path: ChainEntry[] } | undefined;
  verify(): ChainVerifyResult;
}

export function createChainService(deps: {
  store: ChainStore;
  domain?: string;
}): ChainService {
  const domain = deps.domain ?? VERDICT_CHAIN_DOMAIN;
  return {
    append(stored) {
      const existing = deps.store.list().find(
        (e) => e.verdictId === stored.artifact.verdictId,
      );
      if (existing) return existing;
      const entry = appendEntry(
        domain,
        stored.artifact.verdictId,
        artifactHashOf(stored.artifact),
        deps.store.list(),
      );
      deps.store.append(entry);
      return entry;
    },
    head() {
      return deps.store.head() ?? chainHeadOf(domain, deps.store.list());
    },
    entries(from = 0, to) {
      return deps.store.list().slice(from, to);
    },
    proofFor(verdictId) {
      const all = deps.store.list();
      const entry = all.find((e) => e.verdictId === verdictId);
      if (!entry) return undefined;
      return { entry, path: inclusionPath(all, entry.seq) };
    },
    verify() {
      return verifyChain(deps.store.list());
    },
  };
}

/**
 * SLICE-172-4: compact chain-membership digest for the /verify response —
 * `{included, seq?, headHash}` (field absent entirely when chain is off).
 */
export function chainProofOf(
  chain: Pick<ChainService, "head" | "proofFor">,
  verdictId: Hex,
): { included: boolean; seq?: number; headHash: Hex } {
  const p = chain.proofFor(verdictId);
  const head = chain.head();
  return p
    ? { included: true, seq: p.entry.seq, headHash: head.headHash }
    : { included: false, headHash: head.headHash };
}
