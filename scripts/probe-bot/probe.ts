#!/usr/bin/env bun
/**
 * probe-bot CLI (SLICE-234-38, D-234-38-Q9).
 *
 *   bun scripts/probe-bot/probe.ts run [--target URL] [--layer contract|security]
 *        [--endpoints '/api/*,/api/y'] [--scenarios a,b] [--new-only]
 *        [--suspect] [--force] [--db-verify] [--allow-mutations]
 *        [--max-requests N] [--rps N] [--dry-run] [--json]
 *        [--order file.yaml | --order-b64 <b64>]
 *   probe status                 — сводка probe_case по verdict
 *   probe report [--out dir]     — md-артефакт последнего рана (state)
 *   probe requeue <caseKey|endpoint-glob>   — ручной requeue (Q12)
 *   probe scenarios ls           — загруженные сценарии
 *   probe inventory sync|ls      — обновить probe_endpoint из источников
 *
 * Env: PROBE_ALLOWED_HOSTS (csv), PROBE_LOCUS, PROBE_STATE,
 *      PROBE_MAX_REQUESTS, PROBE_RPS. DB — hackathon/server/.env
 *      (DATABASE_URL via fly proxy, DATABASE_ENABLED=1) для dbVerify.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ProbeState, locus } from "./src/state";

const openState = () => {
  const s = ProbeState.open();
  if (!s) die("probe-state: bun:sqlite unavailable — run under bun");
  return s;
};
import { loadScenarios, pickScenarios } from "./src/scenarios";
import { collectEndpoints } from "./src/inventory";
import { runProbes, jsonVerdict, type RunOpts } from "./src/runner";
import { parseOrder } from "./src/order";
import { normalizeTarget } from "./src/safety";
import { writeReport, REPORTS_DIR } from "./src/report";
import type { Endpoint, ProbeOrder } from "./src/types";

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";

function flag(name: string): boolean { return args.includes(`--${name}`); }
function opt(name: string, dflt?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
}
const csv = (s?: string) => s?.split(",").map(x => x.trim()).filter(Boolean);

async function resolveOrder(): Promise<ProbeOrder | null> {
  const b64 = opt("order-b64");
  const file = opt("order");
  if (!b64 && !file) return null;
  const text = b64
    ? Buffer.from(b64, "base64").toString("utf8")
    : readFileSync(resolve(file!), "utf8");
  const { order, issues, error } = parseOrder(text);
  if (error) die(`order parse: ${error}`);
  if (issues.length) {
    die(`order invalid: ${issues.map(i => `${i.field}: ${i.problem}`).join("; ")}`);
  }
  return order!;
}

function die(msg: string): never { console.error(`probe: ${msg}`); process.exit(2); }

async function cmdRun() {
  const order = await resolveOrder();
  const target = normalizeTarget(opt("target") ?? order?.target ?? process.env.PROBE_TARGET ?? "prod");
  const state = openState();

  // endpoints: order/flag globs filter over inventory; --new-only keeps
  // endpoints that have at least one non-pass case or none at all.
  const allEps = await syncInventory(state, target, flag("no-sync"));
  const globs = csv(opt("endpoints")) ?? order?.endpoints ?? [];
  const { matchEndpoint } = await import("./src/inventory");
  let eps = allEps.filter(e => matchEndpoint(e.path, globs));

  const scenarios = pickScenarios(
    await loadScenarios(),
    csv(opt("scenarios")) ?? order?.scenarios,
    opt("layer") ?? order?.layer,
  );

  const runOpts: RunOpts = {
    target,
    layer: (opt("layer") ?? order?.layer) as RunOpts["layer"],
    endpoints: eps,
    scenarios,
    endpointGlobs: [], // already filtered
    maxRequests: Number(opt("max-requests") ?? order?.maxRequests ?? process.env.PROBE_MAX_REQUESTS ?? 300),
    rps: Number(opt("rps") ?? order?.rps ?? process.env.PROBE_RPS ?? 2),
    newOnly: flag("new-only"),
    suspectOnly: flag("suspect"),
    dryRun: flag("dry-run") || order?.dryRun === true,
    allowMutations: flag("allow-mutations") || order?.allowMutations === true,
    force: flag("force"),
    dbVerifyOverride: flag("db-verify") ? true : flag("no-db-verify") ? false : order?.dbVerify,
    state,
  };

  const summary = await runProbes(runOpts);
  const path = writeReport(summary, opt("out") ?? REPORTS_DIR);
  summary.reportPath = path;
  console.log(`\nreport → ${path}`);
  if (flag("json")) {
    console.log("PROBE-JSON-BEGIN");
    console.log(jsonVerdict(summary));
    console.log("PROBE-JSON-END");
  }
}

async function syncInventory(state: ProbeState, target: string, skipSync: boolean): Promise<Endpoint[]> {
  const { endpointsFromRegistry, mergeContracts } = await import("./src/inventory");
  if (skipSync && state.listEndpoints().length) {
    // state хранит path/method/source без contract — досливаем из registry
    return mergeContracts([...state.listEndpoints(), ...endpointsFromRegistry()]);
  }
  const eps = await collectEndpoints({ target });
  for (const ep of eps) state.upsertEndpoint(ep);
  return mergeContracts([...state.listEndpoints(), ...endpointsFromRegistry()]);
}

async function cmdStatus() {
  const state = openState();
  console.log(`locus=${locus()} state=${process.env.PROBE_STATE ?? "(default)"}`);
  console.log("verdicts:", state.countsByVerdict());
  const debt = state.listCases({ limit: 30 }).filter(c => ["fail", "suspect", "inconclusive", "new"].includes(c.verdict));
  if (debt.length) {
    console.log("\nopen cases (new/fail/suspect/inconclusive):");
    for (const c of debt.slice(0, 30)) {
      console.log(`  ${c.verdict.padEnd(12)} ${c.method} ${c.endpoint}  ${c.scenario}  last=${c.last_run ?? "never"}`);
    }
  }
}

async function cmdRequeue() {
  const match = args[1];
  if (!match) die("usage: probe requeue <caseKey|endpoint-glob>");
  const n = openState().requeue(match);
  console.log(`requeued ${n} case(s)`);
}

/** SLICE-234-39: сверка логов local↔prod — один кейс на двух target'ах,
 *  разный ответ = расхождение кода/окружения. */
async function cmdDiff() {
  const state = openState();
  const groups = state.diffByTarget();
  if (!groups.length) {
    console.log("no cross-target cases yet — run the same set on --target local and --target prod");
    return;
  }
  let diverged = 0;
  for (const g of groups) {
    const statuses = new Set(g.map(c => `${c.verdict}:${c.last_status}`));
    const mark = statuses.size > 1 ? "≠" : "=";
    if (statuses.size > 1) diverged++;
    console.log(`${mark} ${g[0].method} ${g[0].endpoint}  [${g[0].scenario}]`);
    for (const c of g) {
      const host = (c.target || "?").replace(/^https?:\/\//, "");
      console.log(`    ${mark} ${host.padEnd(30)} ${c.verdict.padEnd(12)} status=${c.last_status ?? "—"}  ${(c.note ?? "").slice(0, 60)}`);
    }
  }
  console.log(`\n${groups.length} cross-target case(s), ${diverged} diverged`);
}

async function cmdScenarios() {
  if (args[1] !== "ls") die("usage: probe scenarios ls");
  for (const s of await loadScenarios()) {
    console.log(`${s.name.padEnd(18)} layer=${s.layer.padEnd(9)} dbVerify=${s.dbVerify} mutating=${s.mutating}`);
  }
}

async function cmdInventory() {
  const state = openState();
  if (args[1] === "sync") {
    const eps = await collectEndpoints({ target: normalizeTarget(opt("target") ?? "prod") });
    for (const ep of eps) state.upsertEndpoint(ep);
    console.log(`synced ${eps.length} endpoint records`);
    return;
  }
  const rows = state.listEndpoints();
  const bySource = rows.reduce<Record<string, number>>((m, r) => (m[r.source] = (m[r.source] ?? 0) + 1, m), {});
  console.log(`endpoints: ${rows.length} by source:`, bySource);
  for (const r of rows.slice(0, Number(opt("limit") ?? 40))) {
    console.log(`  ${r.method.padEnd(6)} ${r.path}  [${r.source}]`);
  }
}

const HELP = `probe-bot — contract+security probe runner (SLICE-234-38)

  run          исполнить план (dedupe по probe_state, --dry-run для плана)
  status       сводка verdict'ов + открытые кейсы
  requeue      вручную вернуть кейс в 'new' (после фикса)
  scenarios ls список сценариев (yaml+ts)
  inventory    sync|ls — union openapi+x402+code+registry
  report       генерится автоматически после run → docs/LOGS/Analisis/probe-runs/
  diff         сверка кейсов local↔prod (расхождения verdict/status)

Флаги run: --target prod|local|<url> (local = http://localhost:$PORT/4021)
  --layer --endpoints --scenarios --force
  --db-verify --allow-mutations --max-requests --rps --dry-run
  --order file.yaml | --order-b64 <b64> --json --out --no-sync

Прямой доступ к state: sqlite3 scripts/probe-bot/probe-state.db
  SELECT verdict,COUNT(*) FROM probe_case GROUP BY 1;
  SELECT * FROM probe_run ORDER BY started DESC LIMIT 5;
`;

async function main() {
  switch (cmd) {
    case "run": return cmdRun();
    case "status": return cmdStatus();
    case "requeue": return cmdRequeue();
    case "diff": return cmdDiff();
    case "scenarios": return cmdScenarios();
    case "inventory": return cmdInventory();
    case "report": die("report генерится автоматически в конце run — смотри docs/LOGS/Analisis/probe-runs/");
    default: console.log(HELP);
  }
}

if (import.meta.main) {
  main().catch(e => die((e as Error).message));
}
