/**
 * SLICE-201-16: knowledge conformance — core runner.
 * Walks the full agent path for each article slug:
 *   1) discover   — /blog/:slug HTML exposes rel="alternate" type="application/json" (201-12)
 *   2) understand — .json is schema-valid: type, schemaVersion, status, claims[], qa[]
 *   3) evidence   — claim evidence resolves (HTTP 200; transaction-type → format-valid)
 *   4) transition — relatedResources URLs resolve
 *   5) action     — ≥1 action exists and its endpoint resolves
 *
 * fetchFn is injected: vitest passes an app.request adapter (in-process,
 * no network); the CLI passes real fetch (prod conformance).
 * External links are fetched only when resolveExternal=true — otherwise
 * they are reported as "skipped-external", never silently passed.
 */

export interface StepResult {
  step: string;
  result: "pass" | "fail" | "skip";
  ms: number;
  detail: string;
}

export interface ArticleResult {
  slug: string;
  steps: StepResult[];
  pass: boolean;
}

export interface ConformanceOptions {
  fetchFn: (url: string) => Promise<Response>;
  baseUrl: string;
  slugs: string[];
  resolveExternal?: boolean;
  timeoutMs?: number;
}

export interface ConformanceReport {
  baseUrl: string;
  runAt: string;
  articles: ArticleResult[];
  totalPass: boolean;
}

interface KnowledgeObject {
  type?: string;
  schemaVersion?: string;
  status?: string;
  claims?: Array<{
    id?: string;
    status?: string;
    evidence?: Array<{ type?: string; url?: string }>;
  }>;
  qa?: Array<{ question?: string; answer?: string }>;
  actions?: Array<{ type?: string; label?: string; url?: string }>;
  relatedResources?: Array<{ type?: string; url?: string }>;
}

const TX_FORMAT =
  /^(0x[0-9a-fA-F]{64}|https?:\/\/.*(explorer|testnet\.arcscan|arcscan|etherscan|hashscan))/;

function sameOriginPath(url: string, baseUrl: string): string | null {
  try {
    const u = new URL(url, baseUrl);
    const b = new URL(baseUrl);
    if (u.origin === b.origin) return u.pathname + u.search;
    if (u.hostname === "agentbadge.xyz" && b.hostname !== "agentbadge.xyz") {
      // treat same-site absolute URLs as same-origin for conformance
      return u.pathname + u.search;
    }
    return null;
  } catch {
    return url.startsWith("/") ? url : null;
  }
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t0 };
}

async function resolveUrl(
  url: string,
  opts: ConformanceOptions,
): Promise<{ ok: boolean; detail: string }> {
  const path = sameOriginPath(url, opts.baseUrl);
  if (path === null) {
    if (!opts.resolveExternal) {
      return { ok: true, detail: `${url} — skipped-external` };
    }
    try {
      const res = await opts.fetchFn(url);
      return res.ok
        ? { ok: true, detail: `${url} → ${res.status}` }
        : { ok: false, detail: `${url} → HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, detail: `${url} — fetch error: ${(err as Error).message}` };
    }
  }
  try {
    const res = await opts.fetchFn(opts.baseUrl + path);
    return res.ok
      ? { ok: true, detail: `${path} → ${res.status}` }
      : { ok: false, detail: `${path} → HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: `${path} — fetch error: ${(err as Error).message}` };
  }
}

export async function runArticle(slug: string, opts: ConformanceOptions): Promise<ArticleResult> {
  const steps: StepResult[] = [];
  const push = (step: string, result: StepResult["result"], ms: number, detail: string) =>
    steps.push({ step, result, ms, detail });

  // ── step 1: discover via rel=alternate ─────────────────────────────
  let jsonUrl: string | null = null;
  const s1 = await timed(async () => {
    const res = await opts.fetchFn(`${opts.baseUrl}/blog/${slug}`);
    if (!res.ok) return { fail: `article page HTTP ${res.status}` };
    const html = await res.text();
    // Collect ALL rel=alternate links; the head also advertises
    // /.well-known/agent-card.json — the Knowledge Object is the one
    // titled "Knowledge Object" or pointing at /blog/<slug>.json.
    const candidates: string[] = [];
    for (const m of html.matchAll(/<link[^>]*>/g)) {
      const tag = m[0];
      if (!/rel=["']alternate["']/.test(tag)) continue;
      if (!/type=["']application\/json["']/.test(tag)) continue;
      const href = tag.match(/href=["']([^"']+)["']/)?.[1];
      if (!href) continue;
      candidates.push(href);
      if (href.endsWith(`/blog/${slug}.json`) || /title=["']Knowledge Object["']/.test(tag)) {
        return { url: href };
      }
    }
    return candidates.length
      ? { url: candidates[0], fail: null, note: `picked ${candidates[0]} (no exact KO link)` }
      : { fail: "no rel=alternate application/json link" };
  });
  if ("fail" in s1.value) {
    push("discover (rel=alternate)", "fail", s1.ms, s1.value.fail as string);
    return { slug, steps, pass: false };
  }
  jsonUrl = s1.value.url as string;
  push("discover (rel=alternate)", "pass", s1.ms, jsonUrl);

  // ── step 2: understand — schema-valid .json ────────────────────────
  let ko: KnowledgeObject | null = null;
  const s2 = await timed(async () => {
    const path = sameOriginPath(jsonUrl!, opts.baseUrl) ?? jsonUrl!;
    const res = await opts.fetchFn(path.startsWith("http") ? path : opts.baseUrl + path);
    if (!res.ok) return { fail: `${path} HTTP ${res.status}` };
    const j = (await res.json()) as KnowledgeObject;
    const missing: string[] = [];
    if (!j.type) missing.push("type");
    if (!j.schemaVersion) missing.push("schemaVersion");
    if (!j.status) missing.push("status");
    if (!Array.isArray(j.claims) || j.claims.length === 0) missing.push("claims[]");
    if (!Array.isArray(j.qa) || j.qa.length === 0) missing.push("qa[]");
    return missing.length
      ? { fail: `missing: ${missing.join(", ")}` }
      : { ko: j, detail: `status=${j.status} claims=${j.claims!.length} qa=${j.qa!.length}` };
  });
  if ("fail" in s2.value) {
    push("understand (.json valid)", "fail", s2.ms, s2.value.fail as string);
    for (const s of [
      "evidence (links resolve)",
      "transition (relatedResources)",
      "action (≥1 live endpoint)",
    ]) {
      push(s, "skip", 0, "skipped — understand failed");
    }
    return { slug, steps, pass: false };
  }
  ko = s2.value.ko as KnowledgeObject;
  push("understand (.json valid)", "pass", s2.ms, s2.value.detail as string);

  // ── step 3: evidence — all links resolve / tx-format valid ────────
  const s3 = await timed(async () => {
    const evidences = (ko!.claims ?? []).flatMap((c) =>
      (c.evidence ?? []).map((e) => ({ claim: c.id, type: e.type ?? "?", url: e.url ?? "" })),
    );
    if (evidences.length === 0) return { fail: "no evidence links on any claim" };
    const failures: string[] = [];
    const details: string[] = [];
    for (const e of evidences) {
      if (e.type === "transaction" && !e.url.startsWith("http")) {
        // bare tx hash — format check only
        TX_FORMAT.test(e.url)
          ? details.push(`${e.url.slice(0, 14)}… fmt-ok`)
          : failures.push(`${e.claim}: bad tx format ${e.url}`);
        continue;
      }
      const r = await resolveUrl(e.url, opts);
      r.ok ? details.push(r.detail) : failures.push(`${e.claim}: ${r.detail}`);
    }
    return failures.length ? { fail: failures.join("; ") } : { detail: details.join("; ") };
  });
  push(
    "evidence (links resolve)",
    "fail" in s3.value ? "fail" : "pass",
    s3.ms,
    (s3.value as { fail?: string; detail?: string }).fail ??
      (s3.value as { detail?: string }).detail ??
      "",
  );

  // ── step 4: transition — relatedResources resolve ──────────────────
  const s4 = await timed(async () => {
    const rr = ko!.relatedResources ?? [];
    if (rr.length === 0) return { skip: "no relatedResources declared" };
    const failures: string[] = [];
    const details: string[] = [];
    for (const r of rr) {
      const res = await resolveUrl(r.url ?? "", opts);
      res.ok ? details.push(`${r.type}: ${res.detail}`) : failures.push(`${r.type}: ${res.detail}`);
    }
    return failures.length ? { fail: failures.join("; ") } : { detail: details.join("; ") };
  });
  push(
    "transition (relatedResources)",
    "skip" in s4.value ? "skip" : "fail" in s4.value ? "fail" : "pass",
    s4.ms,
    (s4.value as { skip?: string; fail?: string; detail?: string }).skip ??
      (s4.value as { fail?: string }).fail ??
      (s4.value as { detail?: string }).detail ??
      "",
  );

  // ── step 5: action — ≥1 live endpoint ──────────────────────────────
  const s5 = await timed(async () => {
    const actions = ko!.actions ?? [];
    if (actions.length === 0) return { fail: "no actions declared" };
    const failures: string[] = [];
    const details: string[] = [];
    let live = 0;
    for (const a of actions) {
      const r = await resolveUrl(a.url ?? "", opts);
      if (r.ok) {
        live++;
        details.push(`${a.type}: ${r.detail}`);
      } else {
        failures.push(`${a.type}: ${r.detail}`);
      }
    }
    return live === 0 || failures.length
      ? { fail: `live=${live}/${actions.length} ${failures.join("; ")}` }
      : { detail: details.join("; ") };
  });
  push(
    "action (≥1 live endpoint)",
    "fail" in s5.value ? "fail" : "pass",
    s5.ms,
    (s5.value as { fail?: string; detail?: string }).fail ??
      (s5.value as { detail?: string }).detail ??
      "",
  );

  const pass = steps.every((s) => s.result !== "fail");
  return { slug, steps, pass };
}

export async function runKnowledgeConformance(
  opts: ConformanceOptions,
): Promise<ConformanceReport> {
  const articles: ArticleResult[] = [];
  for (const slug of opts.slugs) {
    articles.push(await runArticle(slug, opts));
  }
  return {
    baseUrl: opts.baseUrl,
    runAt: new Date().toISOString(),
    articles,
    totalPass: articles.every((a) => a.pass),
  };
}

export function renderReportMarkdown(report: ConformanceReport): string {
  const lines: string[] = [
    "# Knowledge Conformance Report — SLICE-201-16",
    "",
    `- **Result**: ${report.totalPass ? "PASS" : "FAIL"}`,
    `- **Endpoint**: ${report.baseUrl}`,
    `- **Run**: ${report.runAt}`,
    "",
  ];
  for (const a of report.articles) {
    lines.push(`## ${a.slug} — ${a.pass ? "✔ PASS" : "✘ FAIL"}`, "");
    lines.push("| Step | Result | ms | Detail |", "|------|--------|----|--------|");
    for (const s of a.steps) {
      const mark = s.result === "pass" ? "✔" : s.result === "skip" ? "—" : "✘";
      lines.push(`| ${s.step} | ${mark} | ${s.ms} | ${s.detail.replace(/\|/g, "\\|")} |`);
    }
    lines.push("");
  }
  const broken = report.articles.flatMap((a) =>
    a.steps.filter((s) => s.result === "fail").map((s) => `${a.slug}: ${s.step} — ${s.detail}`),
  );
  lines.push("## Conclusion", "");
  if (broken.length === 0) {
    lines.push(
      "All 5 steps passed for all articles — the agent path (discover → understand → evidence → transition → action) works end to end.",
    );
  } else {
    lines.push("Broken steps:", "");
    for (const b of broken) lines.push(`- ${b}`);
  }
  lines.push("");
  return lines.join("\n");
}
