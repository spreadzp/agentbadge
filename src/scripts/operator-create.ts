/**
 * EPIC-264 (SLICE-264-3): `bun run operator:create` — the break-glass
 * recovery path (D-264-Q15). Shell-side operator + credential creation,
 * SEPARATE from OPERATOR_SEED_JSON: the seed only fires on an empty
 * table; this CLI works whenever a human needs access restored.
 *
 *   bun run operator:create -- --name alice [--type human]
 *       [--caps read,workflow,operator-admin] [--id op_<ulid>]
 *
 * Prints the opk_ plaintext ONCE to stdout — it is never stored and
 * never shown again (sha256+keyPrefix only reach the DB).
 *
 * Refuses on a memory backend: rows written here would die with this
 * process and never reach the running server. For DATABASE_ENABLED=off
 * dev, use OPERATOR_SEED_JSON instead.
 */

import { getConfig, loadConfig } from "../config/env";
import { getDatabase } from "../server/lib/database";
import {
  ADMIN_CAPABILITIES,
  createOperator,
  issueOperatorCredential,
  pickOperatorStores,
  type AdminPrincipalType,
} from "../server/lib/operators";

const PRINCIPAL_TYPES: AdminPrincipalType[] = [
  "human",
  "service",
  "break_glass",
];

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  // `--name --type human` must not treat the next FLAG as the value
  return v !== undefined && !v.startsWith("--") ? v : undefined;
}

async function main(): Promise<void> {
  const name = arg("--name");
  if (!name) {
    console.error(
      "usage: bun run operator:create -- --name <ref> [--type human|service|break_glass] [--caps a,b,c] [--id op_<ulid>]",
    );
    process.exit(2);
  }
  const type = (arg("--type") ?? "human") as AdminPrincipalType;
  if (!PRINCIPAL_TYPES.includes(type)) {
    console.error(`--type must be one of ${PRINCIPAL_TYPES.join("|")}`);
    process.exit(2);
  }
  const capsRaw = arg("--caps");
  const capabilities = capsRaw
    ? capsRaw.split(",").map((s) => s.trim())
    : [...ADMIN_CAPABILITIES];

  loadConfig(); // validates env (DATABASE_* etc.)
  const db = getDatabase();
  const store = pickOperatorStores(db);

  if (store.backend === "memory") {
    const enabled = getConfig().database?.enabled === true;
    console.error(
      enabled
        ? "operator:create refused — DATABASE_ENABLED=true but adminOperators group is absent in the installed @agentbadge/database (rows would land in memory and never persist). Publish the package first."
        : "operator:create refused — DATABASE_ENABLED is off: rows written here die with this process and never reach the running server. Use OPERATOR_SEED_JSON for memory-mode bootstrap.",
    );
    process.exit(3);
  }

  const op = await createOperator(store, {
    id: arg("--id"),
    displayName: name,
    principalType: type,
    capabilities,
  });
  if (!op.ok) {
    console.error(`operator:create failed — ${op.reason}`);
    process.exit(4);
  }
  const cred = await issueOperatorCredential(store, op.operator.id);
  if (!cred.ok) {
    console.error(`credential issue failed — ${cred.reason}`);
    process.exit(5);
  }

  console.log(
    JSON.stringify(
      {
        operatorId: op.operator.id,
        displayName: op.operator.displayName,
        principalType: op.operator.principalType,
        credentialId: cred.credential.id,
        keyPrefix: cred.credential.keyPrefix,
        key: cred.key, // shown ONCE — store it now, it never reappears
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} finally {
  // the shared pool would keep the process alive past stdout —
  // close before exiting so the key actually reaches the shell.
  await getDatabase().close();
}
