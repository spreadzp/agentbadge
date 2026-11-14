#!/usr/bin/env bun
/**
 * EPIC-252 (SLICE-252-1): Agent Request Inbox retention janitor.
 *
 *   bun scripts/janitor-agent-requests.mts [--archive [dir]] [--dry-run]
 *
 * - Deletes rows past expiresAtMs (410 contract).
 * - Purges payloads on completed/failed rows older than
 *   REQUEST_INBOX_PAYLOAD_RETENTION_MS (default 30d) — optional
 *   `--archive <dir>` dumps payloads to JSONL first (falls back to
 *   REQUEST_INBOX_ARCHIVE_DIR).
 * - In-memory backend (--dry-run or DATABASE_ENABLED=false) runs the
 *   same core code path against an empty/ephemeral store and reports
 *   counts without touching anything durable.
 */

import { getConfig } from "../src/config/env";
import { getDatabase } from "../src/server/lib/database";
import { runInboxJanitor } from "../src/server/lib/request-inbox/janitor";
import { pickRequestInboxStores } from "../src/server/lib/request-inbox/db-stores";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const archiveIdx = argv.indexOf("--archive");
const archiveArg =
  archiveIdx >= 0
    ? argv[archiveIdx + 1] && !argv[archiveIdx + 1].startsWith("--")
      ? argv[archiveIdx + 1]
      : undefined
    : undefined;
async function main(): Promise<void> {
  const cfg = getConfig().requestInbox;
  // --archive <dir> wins; bare --archive or no flag falls back to env.
  const archiveDir = archiveArg ?? cfg.archiveDir;

  const db = dryRun ? null : getDatabase();
  const stores = pickRequestInboxStores(
    db ?? { agentRequests: null, agentSurveys: null },
  );

  console.log(
    `[janitor] backend=${stores.backend} retentionMs=${cfg.payloadRetentionMs}` +
      (archiveDir ? ` archiveDir=${archiveDir}` : ""),
  );

  const result = await runInboxJanitor(stores, {
    payloadRetentionMs: cfg.payloadRetentionMs,
    archiveDir,
  });

  console.log(
    `[janitor] expired: ${result.expiredDeleted}/${result.expiredListed} deleted` +
      ` | payloads: ${result.payloadsPurged}/${result.purgeableListed} purged` +
      (result.archiveFile
        ? ` | archived ${result.archived} → ${result.archiveFile}`
        : ""),
  );
  for (const e of result.errors) console.error(`[janitor] ERROR ${e}`);

  if (stores.backend === "memory" && !dryRun) {
    console.log(
      "[janitor] NOTE: in-memory backend — nothing durable was changed " +
        "(DATABASE_ENABLED=false or unreachable)",
    );
  }
  process.exit(result.errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`[janitor] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
