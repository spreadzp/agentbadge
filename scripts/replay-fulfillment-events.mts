#!/usr/bin/env bun
/**
 * SLICE-257-6 (EPIC-257): replay `x402_fulfillment` events captured in
 * warn logs after a ledger append failure.
 *
 *   bun scripts/replay-fulfillment-events.mts <logfile.jsonl> [--dry-run]
 *
 * The emitter logs the COMPLETE serialized EconomicEvent under
 * `context.event` on append failure — this script re-appends those
 * records verbatim. Replay is idempotent: the store dedupes on the
 * deterministic key `ev:x402:{usageRecordId}~fulfill:1`, so re-running
 * over the same log is safe and produces `duplicate`, never double rows.
 *
 * Input: JSONL from the server logger (Docker `json-file` driver,
 * journald --output=json, or `docker logs` output). Non-JSON lines and
 * records without context.event are skipped.
 */

import { readFileSync } from "node:fs";
import { EconomicEventSchema } from "@agentbadge/econ-events";
import { getDatabase } from "../src/server/lib/database";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const file = argv.find((a) => !a.startsWith("--"));

if (!file) {
  console.error(
    "usage: bun scripts/replay-fulfillment-events.mts <logfile.jsonl> [--dry-run]",
  );
  process.exit(2);
}

interface Counters {
  lines: number;
  found: number;
  valid: number;
  invalid: number;
  appended: number;
  duplicate: number;
}

async function main(): Promise<void> {
  const c: Counters = {
    lines: 0,
    found: 0,
    valid: 0,
    invalid: 0,
    appended: 0,
    duplicate: 0,
  };
  const events: ReturnType<typeof EconomicEventSchema.parse>[] = [];

  for (const line of readFileSync(file!, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    c.lines += 1;
    let record: unknown;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue; // not a JSON line (docker prefix, plain text) — skip
    }
    const event = (record as { context?: { event?: unknown } })?.context
      ?.event;
    if (
      !event ||
      (event as { kind?: string }).kind !== "x402_fulfillment"
    )
      continue;
    c.found += 1;
    const parsed = EconomicEventSchema.safeParse(event);
    if (!parsed.success) {
      c.invalid += 1;
      console.warn(`invalid event at line ${c.lines}:`, parsed.error.issues[0]);
      continue;
    }
    c.valid += 1;
    events.push(parsed.data);
  }

  if (!dryRun && events.length > 0) {
    const db = getDatabase();
    if (!db.db || !db.econLedger) {
      console.error(
        "DATABASE_ENABLED=false or no econ-ledger — rerun against a live DB",
      );
      process.exit(3);
    }
    const results = await db.econLedger.append(events);
    c.appended = results.filter((r) => !r.duplicate).length;
    c.duplicate = results.filter((r) => r.duplicate).length;
  }

  console.log(
    JSON.stringify({ ...c, dryRun, file }, null, 2),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
