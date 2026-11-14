/** Agent Request Inbox config (EPIC-252). Always loaded — see request-inbox.ts. */
export interface RequestInboxEnvConfig {
  /** sha256(ip+ua+salt) fingerprint salt. */
  fingerprintSalt: string;
  /** Row TTL — past this a GET returns 410 and janitor may delete. */
  requestTtlMs: number;
  /** completed/failed payload retention (default 30d, decision 2026-11-14). */
  payloadRetentionMs: number;
  /** Optional JSONL archive dir for purged payloads. */
  archiveDir?: string;
}
