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

import type { Endpoint, Layer, ProbeOrder, RunSummary, Scenario, ScenarioContext, Verdict } from "./types";
import { ProbeState, caseKey, locus as getLocus, variantHash } from "./state";
import { applySafety, checkTarget, normalizeTarget, type PlanItem } from "./safety";
import { assertHttp, checkEvent, getPath, makeProdLister, pollEvent, type EventLister, type HttpObservation } from "./verify";

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
  runId?: string;            // override (тесты/повторные прогоны)
  ctx?: ScenarioContext;     // internal — выставляется runProbes
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
      const variants = await sc.variants(ep, opts.ctx);
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
          denyExempt: ep.denyExempt,
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

  // runId генерируется ДО плана — ctx (contract-токены {run_id})
  // получает реальный id прогона
  const runId = opts.runId ?? `run-${Date.now().toString(36)}`;
  const ctx: ScenarioContext = { runId, target };
  const rawPlan = await buildPlan({ ...opts, ctx }, state);
  const plan = applySafety(rawPlan, {
    allowMutations: opts.allowMutations ?? false,
    maxRequests: maxReq,
  });
  for (const reason of plan.abortedReasons) log(`! ${reason}`);
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

  // schemaRef-resolution: openapi.json таргета тянем один раз лениво
  let schemas: Map<string, { required?: string[]; props?: Record<string, string> }> | null = null;
  const resolveSchema = async (v: PlanItem["variant"]): Promise<PlanItem["variant"]> => {
    const ref = v.expect.json?.schemaRef;
    if (!ref) return v;
    if (schemas === null) schemas = await fetchSchemas(fetchFn, target);
    const name = ref.replace(/^openapi/, "").split("/").pop() ?? "";
    const s = schemas.get(name);
    return { ...v, expect: { ...v.expect, json: { ...v.expect.json, schema: s } } };
  };

  for (const it of plan.fire) {
    const v = await resolveSchema(it.variant);
    const tStart = Date.now();
    const flowProblems: string[] = [];
    let obs: HttpObservation;

    if (v.flow) {
      // Stateful-флоу: шаги последовательно, {stepN.<json-path>}
      // подстановки из ответов предыдущих шагов.
      const obsList: HttpObservation[] = [];
      for (let si = 0; si < v.flow.steps.length; si++) {
        const st = v.flow.steps[si];
        const path = substStep(st.path, obsList);
        const headers = st.headers
          ? Object.fromEntries(Object.entries(st.headers).map(([k, s]) => [k, substStep(s, obsList)]))
          : undefined;
        const body = st.body != null ? substStep(st.body, obsList) : undefined;
        const o = await fireStep(fetchFn, target, {
          method: st.method, path, headers, body,
          scenario: it.scenario, caseKey: it.caseKey,
        });
        obsList.push(o);
        const sa = assertHttp(o, st.expect ?? v.expect);
        if (sa.verdict !== "pass") {
          flowProblems.push(`step${si + 1}: ${sa.note}`);
          break; // дальнейшие шаги бессмысленны
        }
        await sleep(1000 / rps);
      }
      if (!flowProblems.length && v.flow.assert) {
        flowProblems.push(...v.flow.assert(obsList));
      }
      const last = obsList[obsList.length - 1] ?? { status: null, requestId: null, bodySnippet: "", error: "flow produced no steps" };
      obs = { ...last };
      if (flowProblems.length) {
        obs.error = flowProblems.join(" | ").slice(0, 400);
      }
    } else {
      obs = await fireStep(fetchFn, target, {
        method: v.method, path: v.path, headers: v.headers, body: v.body,
        scenario: it.scenario, caseKey: it.caseKey,
      });
    }

    const { status, requestId } = obs;
    const durationMs = Date.now() - tStart;

    const http = v.flow && flowProblems.length
      ? { verdict: "fail" as Verdict, note: flowProblems.join(" | ") }
      : assertHttp(obs, v.expect);
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

/** Один HTTP-шаг (обычный вариант или flow-step) → HttpObservation.
 *  Тело читаем до 64KB для JSON-asserts, snippet — 2048 для leak-scan. */
async function fireStep(
  fetchFn: typeof fetch, target: string,
  req: { method: string; path: string; headers?: Record<string, string>; body?: string; scenario: string; caseKey: string },
): Promise<HttpObservation> {
  const obs: HttpObservation = { status: null, requestId: null, bodySnippet: "" };
  try {
    const res = await fetchFn(`${target}${req.path}`, {
      method: req.method,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "user-agent": PROBE_UA,
        "x-probe-scenario": req.scenario,
        "x-probe-case": req.caseKey,
        ...(req.headers ?? {}),
        ...(req.body != null && !req.headers?.["content-type"]
          ? { "content-type": "application/json" } : {}),
      },
      body: req.body,
    });
    obs.status = res.status;
    obs.requestId = res.headers.get("x-request-id");
    const raw = (await res.text()).slice(0, 65536);
    obs.bodySnippet = raw.slice(0, 2048);
    try { obs.bodyJson = JSON.parse(raw); } catch { /* not JSON */ }
    obs.headers = {};
    res.headers.forEach((val, key) => { obs.headers![key.toLowerCase()] = val; });
  } catch (e) {
    obs.error = (e as Error).message.slice(0, 200);
  }
  return obs;
}

/** `{stepN.<json-path>}` → значение из bodyJson шага N (1-based). */
function substStep(s: string, obsList: HttpObservation[]): string {
  return s.replace(/\{step(\d+)\.([A-Za-z0-9_.[\]]+)\}/g, (_, n, p) => {
    const o = obsList[Number(n) - 1];
    const v = o ? getPath(o.bodyJson, p) : undefined;
    return v == null ? "" : String(v);
  });
}

/** Ленивая загрузка схем из /openapi.json таргета для schemaRef. */
async function fetchSchemas(
  fetchFn: typeof fetch, target: string,
): Promise<Map<string, { required?: string[]; props?: Record<string, string> }>> {
  const out = new Map<string, { required?: string[]; props?: Record<string, string> }>();
  try {
    const res = await fetchFn(`${target}/openapi.json`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return out;
    const doc = await res.json() as {
      components?: { schemas?: Record<string, {
        required?: string[];
        properties?: Record<string, { type?: string; $ref?: string }>;
      }> };
    };
    for (const [name, sc] of Object.entries(doc.components?.schemas ?? {})) {
      const props: Record<string, string> = {};
      for (const [k, prop] of Object.entries(sc.properties ?? {})) {
        if (prop.type) props[k] = prop.type;
      }
      out.set(name, { required: sc.required, props });
    }
  } catch { /* openapi недоступен — schema_ref asserts скипнутся */ }
  return out;
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
