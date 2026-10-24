/**
 * SLICE-207-3: board journal → canonical events.
 *
 * `BoardEntryRecord.seq` is already monotonic per card and protected by
 * unique(cardId,seq) — it becomes the canonical (sourceId=cardId, seq)
 * pair directly, so re-emits and backfill re-runs dedupe for free.
 * `note` entries carry no economic fact → skipped (null).
 */

import type { BuildEventInput } from "@agentbadge/econ-events";
import type { EconLedgerStore } from "@agentbadge/database";
import type { BoardEntryRecord } from "../board/types.js";
import { emitEconomicEvent, isoFromMs } from "./emit.js";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;

/**
 * Pure mapper — BoardEntryRecord → canonical BuildEventInput, or null
 * when the entry carries no economic fact.
 */
export function boardEntryToEconomic(
  entry: BoardEntryRecord,
): BuildEventInput | null {
  const base = {
    source: "board",
    sourceId: entry.cardId,
    seq: entry.seq,
    actor: entry.actor,
    at: isoFromMs(entry.atMs),
  };
  const p = entry.payload ?? {};
  switch (entry.kind) {
    case "create":
      return {
        ...base,
        kind: "work_offer",
        payload: {
          taskRef: entry.cardId,
          specHash:
            typeof p["specHash"] === "string" && HEX32.test(p["specHash"] as string)
              ? p["specHash"]
              : undefined,
          budgetUsdc:
            typeof p["budgetUsdc"] === "string" ? p["budgetUsdc"] : undefined,
          terms: { attempt: entry.attempt },
        },
      };
    case "claim":
      return {
        ...base,
        kind: "work_accept",
        payload: { offerRef: entry.cardId, terms: { attempt: entry.attempt } },
      };
    case "submit": {
      // deliver requires a hex32 deliverableHash — skip when absent.
      const dh = (p["deliverableHash"] ?? p["artifactHash"]) as string | undefined;
      if (!dh || !HEX32.test(dh)) return null;
      return {
        ...base,
        kind: "deliver",
        payload: { taskRef: entry.cardId, deliverableHash: dh, attempt: entry.attempt },
      };
    }
    case "qa":
    case "review":
      return {
        ...base,
        kind: "verify",
        payload: {
          taskRef: entry.cardId,
          outcome:
            p["outcome"] === "pass" || p["outcome"] === "fail"
              ? p["outcome"]
              : "inconclusive",
          reasonCodes: Array.isArray(p["reasonCodes"])
            ? (p["reasonCodes"] as string[]).slice(0, 32)
            : undefined,
        },
      };
    case "done":
      return {
        ...base,
        kind: "verify",
        payload: {
          taskRef: entry.cardId,
          outcome: "pass",
          score:
            typeof p["score"] === "number" && p["score"] >= 0 && p["score"] <= 5
              ? (p["score"] as number)
              : undefined,
        },
      };
    case "cancel":
      return {
        ...base,
        kind: "work_offer",
        counterparty: entry.actor,
        payload: { taskRef: entry.cardId, terms: { cancelled: true } },
      };
    case "rating": {
      const subject = (p["subjectAgent"] ?? p["passportId"]) as string | undefined;
      const score = p["score"] as number | undefined;
      if (!subject || typeof score !== "number") return null;
      return {
        ...base,
        kind: "reputation_write",
        payload: {
          subjectAgent: subject,
          score: Math.max(0, Math.min(5, score)),
          txHash: entry.txHash && HEX32.test(entry.txHash) ? entry.txHash : undefined,
        },
      };
    }
    case "bug":
    case "reopen":
    case "note":
    default:
      return null; // no economic fact — flag/dispute kinds are post-v1
  }
}

/** Emit for a journal append — call AFTER the entry was stored. */
export function emitBoardEntry(
  entry: BoardEntryRecord,
  ledger?: EconLedgerStore | null,
): void {
  const input = boardEntryToEconomic(entry);
  if (input) emitEconomicEvent(input, ledger);
}
