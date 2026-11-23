// EPIC-262 (SLICE-262-11): db-first client-report store selection
// (same pick convention as scan-job store). `intelClientReports`
// ships with the next published @agentbadge/database; until then →
// shared memory.

import type { Database } from "@agentbadge/database";
import { createMemoryIntelClientReportStore } from "./memory";
import type { IntelClientReportStore } from "./types";

let shared: IntelClientReportStore | undefined;

export function pickIntelClientReportStore(
  db: Database | { intelClientReports?: IntelClientReportStore | null },
): { store: IntelClientReportStore; backend: "postgres" | "memory" } {
  const repo = "intelClientReports" in db ? db.intelClientReports : undefined;
  if (repo) return { store: repo, backend: "postgres" };
  return { store: (shared ??= createMemoryIntelClientReportStore()), backend: "memory" };
}
