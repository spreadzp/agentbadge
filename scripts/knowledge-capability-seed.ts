/**
 * EPIC-229 (SLICE-229-4): capability seed CLI.
 *
 *   bun scripts/knowledge-capability-seed.ts           → seed + report
 *   bun scripts/knowledge-capability-seed.ts --check   → drift only,
 *         exit 1 when SEEDED drift exists (code removed/renamed a
 *         capability the registry still claims)
 *
 * Reads DATABASE_URL/.env via config; memory fallback seeds the
 * in-process store only (useless across runs but harmless for a
 * smoke pass).
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
    return;
  }

  const report = await seedCapabilities(store);
  console.log(
    JSON.stringify(
      {
        backend: store.backend,
        total: report.total,
        added: report.added,
        existing: report.existing,
        newlyAdded: report.newlyAddedNames,
        dbOnlySeededDrift: report.dbOnlySeeded,
      },
      null,
      2,
    ),
  );
  await database.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
