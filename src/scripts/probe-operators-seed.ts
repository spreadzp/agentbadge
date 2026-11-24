/**
 * EPIC-264 (SLICE-264-15): `bun run operators:seed-probe` — plants
 * the probe-bot credentials the trust-model scenarios run under.
 *
 * The env contract (plaintext opk_ lives ONLY in .env — the DB
 * stores sha256 + keyPrefix, so a seed rerun is a strict no-op):
 *
 *   PROBE_KEY_A / _B / _C   → probe-a/b/c   service [probe,workflow]
 *                            (lifecycle: A submits, B verifies, C
 *                            publishes — the two-PRINCIPAL SoD shape)
 *   PROBE_KEY_NOFLOW        → probe-noflow  service [probe]
 *                            (insufficient-capability battery case)
 *   PROBE_KEY_REVOKED       → probe-revoked service [probe,workflow]
 *                            cred issued then revoked — stays revoked
 *   PROBE_KEY_DISABLED      → probe-disabled service [probe,workflow]
 *                            operator disabled after cred — stays down
 *
 * Idempotent by (displayName, keyHash): rerun finds rows and skips;
 * it never resurrects a revoked cred / re-enables a disabled
 * operator — those states ARE the fixture. A key ROTATION (env key
 * differs from the stored hash) issues a second credential rather
 * than overwriting — old creds are never touched here (revoke by
 * hand if a rotation must retire them).
 *
 * svc_* displayNames are refused by AGENT_NAME_DENY (service
 * principals must not look agent-shaped in audit, Arc R1 H2) —
 * probe-* is the honest shape.
 *
 * Mint the plaintexts once, paste into .env, then seed:
 *   bun -e 'import {generateAdminKeyPlaintext} from
 *     "./src/server/lib/operators/operator-key.ts";
 *     console.log(generateAdminKeyPlaintext())'   # ×6
 */

import { loadConfig } from "../config/env";
import { getDatabase } from "../server/lib/database";
import {
  createOperator,
  pickOperatorStores,
  type AdminCapability,
  type OperatorStore,
} from "../server/lib/operators";
import {
  adminKeyPrefix,
  hashAdminKey,
  isAdminKeyPlaintext,
} from "../server/lib/operators/operator-key";
import { generateReportId } from "../agent-readiness/integrity/ulid";

interface ProbeCredSpec {
  env: string;
  displayName: string;
  caps: AdminCapability[];
  /** Post-issuance fixture state — the seed reaches it once and
   *  then reports "exists" on reruns. */
  fixture?: "revoked_credential" | "disabled_operator";
}

const SPECS: ProbeCredSpec[] = [
  { env: "PROBE_KEY_A", displayName: "probe-a", caps: ["probe", "workflow"] },
  { env: "PROBE_KEY_B", displayName: "probe-b", caps: ["probe", "workflow"] },
  { env: "PROBE_KEY_C", displayName: "probe-c", caps: ["probe", "workflow"] },
  { env: "PROBE_KEY_NOFLOW", displayName: "probe-noflow", caps: ["probe"] },
  {
    env: "PROBE_KEY_REVOKED",
    displayName: "probe-revoked",
    caps: ["probe", "workflow"],
    fixture: "revoked_credential",
  },
  {
    env: "PROBE_KEY_DISABLED",
    displayName: "probe-disabled",
    caps: ["probe", "workflow"],
    fixture: "disabled_operator",
  },
];

async function seedOne(
  store: OperatorStore,
  spec: ProbeCredSpec,
  key: string,
): Promise<string> {
  const ops = await store.listOperators();
  let op = ops.find((o) => o.displayName === spec.displayName);
  let note = "operator exists";
  if (!op) {
    const r = await createOperator(store, {
      displayName: spec.displayName,
      principalType: "service",
      capabilities: spec.caps,
    });
    if (!r.ok) return `FAIL operator:${r.reason}`;
    op = r.operator;
    note = "operator created";
  }
  const keyHash = hashAdminKey(key);
  const creds = await store.listCredentialsForOperator(op.id);
  let cred = creds.find((c) => c.keyHash === keyHash);
  if (!cred) {
    const r = await store.issueCredential({
      id: `opc_${generateReportId()}`,
      operatorId: op.id,
      keyHash,
      keyPrefix: adminKeyPrefix(key),
    });
    if (!r.ok) return `FAIL credential:${r.reason}`;
    cred = r.credential;
    note += " + cred issued";
  } else {
    note += " + cred exists";
  }
  if (spec.fixture === "revoked_credential" && cred.status !== "revoked") {
    const r = await store.revokeCredential(cred.id);
    if (!r.ok) return `FAIL revoke:${r.reason}`;
    note += " → revoked";
  }
  if (spec.fixture === "disabled_operator" && op.status !== "disabled") {
    const r = await store.disableOperator(op.id);
    if (!r.ok) return `FAIL disable:${r.reason}`;
    note += " → disabled";
  }
  return `${op.id} ${note}`;
}

async function main(): Promise<void> {
  const missing = SPECS.filter((s) => {
    const k = process.env[s.env];
    return k === undefined || k === "" || !isAdminKeyPlaintext(k);
  }).map((s) => s.env);
  if (missing.length > 0) {
    console.error(
      `missing/malformed env: ${missing.join(", ")} — mint via\n` +
        '  bun -e \'import {generateAdminKeyPlaintext} from "./src/server/lib/operators/operator-key.ts"; console.log(generateAdminKeyPlaintext())\'',
    );
    process.exit(2);
  }

  loadConfig();
  const store = pickOperatorStores(getDatabase());
  if (store.backend === "memory") {
    console.error(
      "operators:seed-probe refused — memory backend: rows die with " +
        "this process and never reach the running server.",
    );
    process.exit(3);
  }
  let failed = false;
  for (const spec of SPECS) {
    const out = await seedOne(store, spec, process.env[spec.env]!);
    console.log(`${spec.displayName.padEnd(15)} ${out}`);
    if (out.startsWith("FAIL")) failed = true;
  }
  if (failed) process.exit(4);
}

try {
  await main();
} finally {
  await getDatabase().close();
}
