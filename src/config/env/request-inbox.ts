/**
 * Agent Request Inbox config section (EPIC-252, SLICE-252-1).
 * Always loaded — the section carries operational defaults, not a
 * feature gate (store selection is DB|in-memory, DATABASE_ENABLED owns
 * that switch).
 *
 * - REQUEST_INBOX_FINGERPRINT_SALT — salt for sha256(ip+ua+salt) fpHash.
 *   Dev default keeps local/test runs deterministic; production MUST set
 *   a real secret (it is the only thing standing between the hash and a
 *   dictionary of likely ip+ua pairs).
 * - REQUEST_INBOX_REQUEST_TTL_MS — row lifetime; after it a GET returns
 *   410 and the janitor may delete the row. Default 7d.
 * - REQUEST_INBOX_PAYLOAD_RETENTION_MS — how long a completed/failed
 *   request keeps its original payload. Default 30d (decision
 *   2026-11-14); janitor purges older payloads.
 * - REQUEST_INBOX_ARCHIVE_DIR — optional JSONL archive target for
 *   purged payloads (janitor --archive flag overrides).
 */

import type { RequestInboxEnvConfig } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

const numEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function loadRequestInbox(): RequestInboxEnvConfig {
  return {
    fingerprintSalt:
      process.env.REQUEST_INBOX_FINGERPRINT_SALT ??
      "agentbadge-request-inbox-dev-salt",
    requestTtlMs: numEnv("REQUEST_INBOX_REQUEST_TTL_MS", 7 * DAY_MS),
    payloadRetentionMs: numEnv(
      "REQUEST_INBOX_PAYLOAD_RETENTION_MS",
      30 * DAY_MS,
    ),
    archiveDir: process.env.REQUEST_INBOX_ARCHIVE_DIR || undefined,
  };
}
