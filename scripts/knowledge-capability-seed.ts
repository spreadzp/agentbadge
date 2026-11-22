/**
 * EPIC-229 (SLICE-229-4): capability seed CLI.
 *
 *   bun scripts/knowledge-capability-seed.ts           → seed + report
 *   bun scripts/knowledge-capability-seed.ts --check   → drift only,
 *         exit 1 when SEEDED drift exists (code removed/renamed a
 *         capability the registry still claims)
 *
 * Reads DATABASE_URL/.env via config. Refuses a non-persistent
 * (memory) backend — seeding an in-process store silently "succeeds"
 * and dies with the process (Arc R2 M-15). Use --check --memory for a
 * smoke pass.
 */

import { getConfig } from "../src/config/env";
import { createDatabase } from "@agentbadge/database";
import {
  capabilityDrift,
  seedCapabilities,
} from "../src/server/lib/knowledge/capability-seed";
import { pickKnowledgeStores } from "../src/server/lib/knowledge";

async function main() {
  const check = process.argv.includes("--check");
  const section = getConfig().database;
  const database = createDatabase({
    enabled: section?.enabled ?? Boolean(process.env.DATABASE_URL),
    url: section?.url ?? process.env.DATABASE_URL,
  });
  const store = pickKnowledgeStores(database);

  // Arc R2 M-15: a successful seed on the memory backend is a lie —
  // it exists only for this process. Require --memory explicitly so
  // the smoke pass stays possible but can never be accidental.
  const allowMemory = process.argv.includes("--memory");
  if (store.backend !== "postgres" && !allowMemory) {
    console.error(
      `refusing to seed: backend is '${store.backend}' (in-process). ` +
        `set DATABASE_URL for a real seed, or pass --memory for a smoke pass.`,
    );
    process.exit(1);
  }

  if (check) {
    const drift = await capabilityDrift(store);
    console.log(
      JSON.stringify(
        {
          codeOnly: drift.codeOnly,
          dbOnlySeeded: drift.dbOnlySeeded,
          dbOnlyManualOk: drift.dbOnlyManual,
        },
        null,
        2,
      ),
    );
    if (drift.dbOnlySeeded.length > 0 || drift.codeOnly.length > 0) {
      console.error(
        `DRIFT: ${drift.codeOnly.length} code-only, ${drift.dbOnlySeeded.length} seeded db-only`,
      );
      process.exit(1);
    }
    console.log("no drift");
    await database.close();
    return;
  }

  const report = await seedCapabilities(store);
  // Arc R4 M-8: the report used to drop failed/manualOwned and exit
  // 0 on failures — a silently broken seed looked green.
  console.log(
    JSON.stringify(
      {
        backend: store.backend,
        total: report.total,
        added: report.added,
        existing: report.existing,
        newlyAdded: report.newlyAddedNames,
        manualOwned: report.manualOwned,
        failed: report.failed,
        dbOnlySeededDrift: report.dbOnlySeeded,
        driftUnverified: report.unverified,
        driftGuardTripped: report.driftGuardTripped,
      },
      null,
      2,
    ),
  );
  await database.close();
  if (report.failed.length > 0 || report.driftGuardTripped) {
    console.error(
      `seed incomplete: ${report.failed.length} failed` +
        (report.driftGuardTripped ? ", drift unverify guarded off" : ""),
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
