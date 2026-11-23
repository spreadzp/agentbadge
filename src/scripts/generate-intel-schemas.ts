// EPIC-262 (SLICE-262-1): emit the versioned evidence contract —
// JSON Schema draft 2020-12 for both schemas + deterministic signed
// fixtures — into docs/EPICS/262-agent-surface-intelligence/spec/.
// These files are the single authoritative source the WP plugin (PHP)
// consumes without Node (D-262-Q12). Regenerate: bun run generate:intel-schemas
import { z } from "zod";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import {
  collectorSubmissionSchema,
  canonicalEnvelopeSchema,
} from "../server/lib/intel/evidence";
import {
  buildPositiveFixtures,
  buildNegativeFixtures,
} from "./intel-fixture-builder";

const specDir = join(
  dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "docs",
  "EPICS",
  "262-agent-surface-intelligence",
  "spec",
);

const write = (rel: string, data: unknown) => {
  const path = join(specDir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  console.log(`  ${path}`);
};

console.log("Intel evidence contract artifacts:");
write("schemas/collector-submission.schema.json", {
  $id: "https://agentbadge.xyz/schemas/intel/collector-submission/v1",
  title: "Collector Submission (untrusted input DTO, v1)",
  ...z.toJSONSchema(collectorSubmissionSchema, { target: "draft-2020-12" }),
});
write("schemas/canonical-envelope.schema.json", {
  $id: "https://agentbadge.xyz/schemas/intel/canonical-envelope/v1",
  title: "Canonical Evidence Envelope (backend-owned, v1)",
  ...z.toJSONSchema(canonicalEnvelopeSchema, { target: "draft-2020-12" }),
});

for (const f of buildPositiveFixtures()) {
  write(`fixtures/envelopes/${f.file}`, f.envelope);
}
for (const f of buildNegativeFixtures()) {
  write(`fixtures/negative/${f.file}`, {
    expected_error: f.expected_error,
    document: f.document,
  });
}
console.log("Done — fixtures are deterministic (fixed seed), rerun anytime.");
