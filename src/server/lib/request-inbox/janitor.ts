import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";

import type { RequestInboxStores } from "./store";
import type { InboxRequestRecord } from "./types";
import { normalizeQuestion, questionHashFor } from "./fingerprint";
import {
  materializeQaPairForRecord,
  payloadQuestionText,
} from "./qa";

/**
 * EPIC-252 (SLICE-252-1, decision 2026-11-14): retention janitor.
 *
 * Two legs, in this order:
 * 1. HARD-DELETE expired rows (expiresAtMs < now) — the 410 contract
 *    only needs the row gone; nothing is archived.
 * 2. PAYLOAD-PURGE completed/failed rows older than retention —
 *    `payload` → null; state/response/fingerprint/metadata stay.
 *    With `archiveDir` set, purged payloads are first dumped to a
 *    JSONL file (`agent-requests-<YYYYMMDD>.jsonl`) so the corpus can
 *    be rebuilt offline.
 *
 * QA pairs are never touched (D-252-Q7 — the corpus is the value).
 * The function is backend-agnostic: it only speaks to the store
 * interface, so in-memory runs exercise the identical code path.
 */
export interface JanitorResult {
  backend: string;
  expiredListed: number;
  expiredDeleted: number;
  purgeableListed: number;
  payloadsPurged: number;
  archived: number;
  archiveFile?: string;
  /** SLICE-256-9 (review R-2): consented completed requests whose
   *  corpus pair is missing — retried materialization. */
  qaPendingListed: number;
  qaRematerialized: number;
  errors: string[];
}

export interface JanitorOptions {
  /** completed/failed rows older than this keep no payload. */
  payloadRetentionMs: number;
  /** JSONL archive target — skips archiving when undefined. */
  archiveDir?: string;
  nowMs?: number;
  /** Safety bound per leg (default 500). */
  limit?: number;
}

export async function runInboxJanitor(
  stores: RequestInboxStores,
  opts: JanitorOptions,
): Promise<JanitorResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const limit = opts.limit ?? 500;
  const result: JanitorResult = {
    backend: stores.backend,
    expiredListed: 0,
    expiredDeleted: 0,
    purgeableListed: 0,
    payloadsPurged: 0,
    archived: 0,
    qaPendingListed: 0,
    qaRematerialized: 0,
    errors: [],
  };

  // Leg 1: expired rows → hard delete.
  const expired = await stores.requests.listExpired(nowMs, limit);
  result.expiredListed = expired.length;
  for (const r of expired) {
    try {
      if (await stores.requests.delete(r.id)) result.expiredDeleted += 1;
    } catch (err) {
      result.errors.push(`delete ${r.id}: ${String(err)}`);
    }
  }

  // Leg 2: old terminal payloads → optional archive → purge.
  const cutoff = nowMs - opts.payloadRetentionMs;
  const purgeable = await stores.requests.listPurgeable(cutoff, limit);
  result.purgeableListed = purgeable.length;

  let archiveOk = true;
  if (opts.archiveDir !== undefined && purgeable.length > 0) {
    try {
      await mkdir(opts.archiveDir, { recursive: true, mode: 0o700 });
      const stamp = new Date(nowMs).toISOString().slice(0, 10).replaceAll("-", "");
      const file = join(opts.archiveDir, `agent-requests-${stamp}.jsonl`);
      const lines = purgeable.map((r) =>
        JSON.stringify({
          id: r.id,
          kind: r.kind,
          payload: r.payload,
          fpHash: r.fpHash,
          agentId: r.agentId,
          createdAtMs: r.createdAtMs,
          archivedAtMs: nowMs,
        }),
      );
      // Audit H-7: append (not overwrite) — two same-day runs must
      // accumulate, and 0600 keeps payloads owner-only. The file is
      // keyed by archive day; re-runs append, never truncate.
      await appendFile(file, lines.join("\n") + "\n", {
        encoding: "utf8",
        mode: 0o600,
      });
      result.archiveFile = file;
      result.archived = lines.length;
    } catch (err) {
      archiveOk = false;
      result.errors.push(`archive: ${String(err)}`);
    }
  }

  // Audit H-7: never purge what wasn't archived — a failed archive
  // must leave payloads intact rather than silently destroy data.
  if (!archiveOk) {
    result.errors.push("purge skipped: archive failed");
    return result;
  }

  for (const r of purgeable) {
    try {
      if (await stores.requests.purgePayload(r.id)) {
        result.payloadsPurged += 1;
      }
    } catch (err) {
      result.errors.push(`purge ${r.id}: ${String(err)}`);
    }
  }

  // Leg 3 (SLICE-256-9, review R-2): QA re-materialization. The respond
  // path deliberately swallows upsert failures (a 5xx must not roll
  // back a committed transition), so a consented pair can be missing;
  // this leg closes consent → publication eventually. A live pair with
  // the same questionHash already covers the question (dedupe bumped
  // uses), so we only retry rows with no live pair at all.
  const completed = await stores.requests.listByState({
    state: "completed",
    limit,
  });
  for (const r of completed) {
    if (r.publishToQa !== true || r.spamFlag || r.response == null)
      continue;
    const question = payloadQuestionText(r.payload);
    if (!question) continue;
    result.qaPendingListed += 1;
    try {
      const hash = questionHashFor(normalizeQuestion(question));
      // Any row for this hash — live OR retracted — means "already
      // handled": a retracted pair must not resurrect (ops retracted
      // deliberately), a live pair already covers the question.
      const existing =
        await stores.requests.getQaByHashIncludingRetracted(hash);
      if (existing) continue;
      if (await materializeQaPairForRecord(stores.requests, r)) {
        result.qaRematerialized += 1;
      }
    } catch (err) {
      result.errors.push(`qa-rematerialize ${r.id}: ${String(err)}`);
    }
  }

  return result;
}

/** Records a janitor sees — re-export for the script's archive output. */
export type { InboxRequestRecord };
