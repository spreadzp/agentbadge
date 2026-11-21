/**
 * Runner — orchestrates a probe run (D-234-38-Q5/Q8/Q12).
 *
 * Plan: endpoints × scenarios → variants → probe_case stubs.
 * Dedupe: cases with verdict='pass' are skipped (requeue is manual).
 * Execute: sequential at --rps (default 2 — no DoS), UA tag
 * AgentBadge-ProbeBot so our own traffic is distinguishable (F5).
 * Verify: HTTP-assert every case; dbVerify cases also poll event
 * table by requestId.
 * Abort: >10% consecutive 5xx — that IS the finding; stop + report.
 */

import type { Endpoint, Layer, ProbeOrder, RunSummary, Scenario, Verdict } from "./types";
import { ProbeState, caseKey, locus as getLocus, variantHash } from "./state";
import { applySafety, checkTarget, normalizeTarget, type PlanItem } from "./safety";
import { assertHttp, checkEvent, makeProdLister, pollEvent, type EventLister } from "./verify";

export const PROBE_UA = "AgentBadge-ProbeBot/0.1";

export interface RunOpts {
  target: string;
  layer?: Layer;
  endpoints: Endpoint[];
  scenarios: Scenario[];
  endpointGlobs?: string[];
  maxRequests?: number;
  rps?: number;
  dryRun?: boolean;
  allowMutations?: boolean;
  force?: boolean;           // rerun pass cases too
  newOnly?: boolean;         // only verdict='new' cases
  suspectOnly?: boolean;     // only fail/suspect/inconclusive
  dbVerifyOverride?: boolean;
  state?: ProbeState;
  lister?: EventLister;      // injectable for tests
  sleep?: (ms: number) => Promise<void>;
  fetchFn?: typeof fetch;
  onResult?: (line: string) => void;
}

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function buildPlan(opts: RunOpts, state: ProbeState): Promise<PlanItem[]> {
  const items: PlanItem[] = [];
  const seen = new Set<string>(); // :id и {id} дают одинаковый финальный path
  const globs = opts.endpointGlobs ?? [];
  const target = normalizeTarget(opts.target);
  const { matchEndpoint } = await import("./inventory");

  for (const sc of opts.scenarios) {
    for (const ep of opts.endpoints) {
      if (!matchEndpoint(ep.path, globs)) continue;
      if (!sc.applies(ep)) continue;
      const variants = await sc.variants(ep);
      for (const v of variants) {
        const vh = variantHash(v);
        // кейс привязан к ФИНАЛЬНОМУ запросу (подставленный path) —
        // :id и {id} шаблоны сходятся в один case_key → дедуп бесплатно.
        const key = caseKey({
          locus: getLocus(), target, endpoint: v.path, method: v.method,
          scenario: sc.name, variantHash: vh,
        });
        if (seen.has(key)) continue;
        seen.add(key);
        // read-only: стаб вставляется только когда кейс реально пойдёт
        // в огонь (runProbes после applySafety) — dry-run и усечённый
        // бюджет не засоряют probe_case 'new'-строками.
        const verdict = state.getCase(key)?.verdict ?? "new";
        const skip =
          (opts.newOnly && verdict !== "new") ||
          (opts.suspectOnly && !["fail", "suspect", "inconclusive"].includes(verdict)) ||
          (verdict === "pass" && !opts.force);
        items.push({
          caseKey: key, endpoint: v.path, method: v.method,
          scenario: sc.name, layer: sc.layer,
          mutating: sc.mutating, dbVerify: sc.dbVerify,
          variantHash: vh,
          variant: v,
          skippedReason: skip ? "already pass" : undefined,
        });
      }
    }
  }
  return items;
}

export async function runProbes(opts: RunOpts): Promise<RunSummary> {
  const state = opts.state ?? ProbeState.open();
  if (!state) throw new Error("probe-state: bun:sqlite unavailable (run under bun)");
  const target = normalizeTarget(opts.target);
  const t = checkTarget(target);
  if (!t.ok) throw new Error(`safety: ${t.reason}`);

  const maxReq = opts.maxRequests ?? 300;
  const rps = Math.min(opts.rps ?? 2, 10);
  const fetchFn = opts.fetchFn ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const log = opts.onResult ?? ((s: string) => console.log(s));

  const rawPlan = await buildPlan(opts, state);
  const plan = applySafety(rawPlan, {
    allowMutations: opts.allowMutations ?? false,
    maxRequests: maxReq,
  });
  for (const reason of plan.abortedReasons) log(`! ${reason}`);

  const runId = `run-${Date.now().toString(36)}`;
  const summary: RunSummary = {
    runId, target, locus: getLocus(),
    layer: opts.layer ?? "all", started: new Date().toISOString(),
    dryRun: opts.dryRun ?? false,
    counts: { new: 0, pass: 0, fail: 0, suspect: 0, inconclusive: 0, skipped: plan.skipped.length },
    results: [],
  };

  if (opts.dryRun) {
    for (const it of plan.fire) {
      log(`[dry] ${it.variant.method} ${it.variant.path}  ← ${it.scenario}${it.mutating ? " [mutating]" : ""}`);
      summary.results.push({
        caseKey: it.caseKey, endpoint: it.endpoint, method: it.variant.method,
        layer: it.layer as Layer, scenario: it.scenario,
        variantHash: it.variantHash, expected: it.variant.expect,
        verdict: "new", status: null, requestId: null, durationMs: null, note: "dry-run",
      });
    }
    summary.ended = new Date().toISOString();
    return summary;
  }

  // стабы — только для реально идущих в огонь кейсов (после бюджета/
  // denylist и после dry-run ветки — dry не пишет state)
  for (const it of plan.fire) {
    state.ensureCase({
      case_key: it.caseKey, endpoint: it.endpoint, method: it.method,
      layer: it.layer, scenario: it.scenario, variant_hash: it.variantHash,
      expected_json: JSON.stringify(it.variant.expect ?? {}), locus: getLocus(), target,
    });
  }

  state.startRun({ id: runId, target, locus: getLocus(), layer: summary.layer });
  const lister = opts.lister ?? makeProdLister();
  const t0 = summary.started;
  let consec5xx = 0;

  for (const it of plan.fire) {
    const v = it.variant;
    let status: number | null = null;
    let requestId: string | null = null;
    let bodySnippet = "";
    let resHeaders: Record<string, string> | undefined;
    let error: string | undefined;
    const tStart = Date.now();

    try {
      const res = await fetchFn(`${target}${v.path}`, {
        method: v.method,
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "user-agent": PROBE_UA,
          "x-probe-scenario": it.scenario,
          "x-probe-case": it.caseKey,
          ...(v.headers ?? {}),
          ...(v.body != null && !v.headers?.["content-type"]
            ? { "content-type": "application/json" } : {}),
        },
        body: v.body,
      });
      status = res.status;
      requestId = res.headers.get("x-request-id");
      bodySnippet = (await res.text()).slice(0, 2048);
      resHeaders = {};
      res.headers.forEach((val, key) => { resHeaders![key.toLowerCase()] = val; });
    } catch (e) {
      error = (e as Error).message.slice(0, 200);
    }
    const durationMs = Date.now() - tStart;

    const http = assertHttp({ status, requestId, bodySnippet, headers: resHeaders, error }, v.expect);
    let verdict: Verdict = http.verdict;
    let note = http.note;

    // suspect marker: passes contract but status differs from last observation
    const prev = state.getCase(it.caseKey);
    if (verdict === "pass" && prev?.last_status != null && status != null && prev.last_status !== status) {
      verdict = "suspect";
      note += ` | status changed ${prev.last_status}→${status}`;
    }

    // dbVerify: confirm the hit landed in event table (and telemetry works)
    const wantDb = opts.dbVerifyOverride ?? it.dbVerify;
    if (wantDb && requestId && status != null) {
      const ev = await pollEvent(lister, t0, requestId, { timeoutMs: 10_000 });
      const chk = checkEvent(ev, status);
      if (!chk.found) {
        verdict = "inconclusive";
        note += " | dbVerify: no event within 10s (telemetry gap or edge drop)";
      } else if (chk.verdict === "mismatch") {
        verdict = "fail";
        note += ` | dbVerify: event status ${chk.recordedStatus} ≠ response ${status}`;
      } else {
        note += ` | dbVerify: event ✓`;
      }
    }

    summary.counts[verdict]++;
    summary.results.push(mkResult(it, v, verdict, status, requestId, durationMs, note));
    state.recordResult(it.caseKey, { verdict, status, requestId, note });
    log(`${verdict.toUpperCase().padEnd(12)} ${v.method} ${v.path} → ${status ?? "ERR"} (${it.scenario})`);

    if (status != null && status >= 500) {
      if (++consec5xx >= Math.max(3, Math.ceil(plan.fire.length * 0.1))) {
        log(`! abort — 5xx streak (that IS the finding)`);
        break;
      }
    } else consec5xx = 0;
    await sleep(1000 / rps);
  }

  for (const it of plan.skipped) summary.counts.skipped = (summary.counts.skipped ?? 0) + 1;
  summary.ended = new Date().toISOString();
  state.endRun(runId, summary.counts, summary.reportPath);
  return summary;
}

function mkResult(it: PlanItem, v: PlanItem["variant"], verdict: Verdict,
  status: number | null, requestId: string | null, durationMs: number, note: string) {
  return {
    caseKey: it.caseKey, endpoint: it.endpoint, method: v.method,
    layer: it.layer as Layer, scenario: it.scenario,
    variantHash: it.variantHash, expected: v.expect,
    verdict, status, requestId, durationMs, note,
  };
}

/** Run summary → compact JSON verdict for bridge answers (Q17). */
export function jsonVerdict(s: RunSummary): string {
  return JSON.stringify({
    runId: s.runId, target: s.target, locus: s.locus, dryRun: s.dryRun,
    counts: s.counts,
    suspects: s.results
      .filter(r => r.verdict === "fail" || r.verdict === "suspect" || r.verdict === "inconclusive")
      .map(r => ({ endpoint: r.endpoint, scenario: r.scenario, status: r.status, requestId: r.requestId, note: r.note.slice(0, 160) })),
    reportPath: s.reportPath ?? null,
  }, null, 2);
}
