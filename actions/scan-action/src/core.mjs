// agentbadge/scan-action — core logic, dependency-free (node builtins
// + global fetch). Imported by index.mjs inside the action runtime and
// by the repo's vitest suite with an injected fetch — the network is
// a seam, never a global.

/**
 * @param {object} args
 * @param {{apiBase: string, siteKey: string, siteId?: string,
 *          scan: boolean, failOn: "new_finding"|"score_drop"|"none",
 *          minScore: number}} args.input
 * @param {typeof fetch} [args.fetchImpl]
 */
export async function runAction({ input, fetchImpl = fetch }) {
  const base = input.apiBase.replace(/\/+$/, "");
  const headers = {
    authorization: `Bearer ${input.siteKey}`,
    "content-type": "application/json",
  };
  const annotations = [];

  if (input.scan) {
    const scanRes = await fetchImpl(`${base}/api/intel/scans`, {
      method: "POST",
      headers,
      body: "{}",
    });
    if (scanRes.status === 429) {
      // cooldown is not a failure — the diff still runs against the
      // freshest stored reports and the wait is surfaced honestly
      const body = await scanRes.json().catch(() => ({}));
      annotations.push({
        level: "notice",
        message:
          `scan cooldown — diffing the last stored reports ` +
          `(retry in ${body.retry_after_seconds ?? "?"}s)`,
      });
    } else if (!scanRes.ok) {
      return fail(await err(scanRes, "scan"));
    }
  }

  const qs = input.siteId ? `?site=${encodeURIComponent(input.siteId)}` : "";
  const [diffRes, sarifRes] = await Promise.all([
    fetchImpl(`${base}/api/intel/report-diff${qs}`, { headers }),
    fetchImpl(`${base}/api/intel/report-diff${qs ? `${qs}&` : "?"}format=sarif`, { headers }),
  ]);
  if (!diffRes.ok) return fail(await err(diffRes, "report-diff"));
  const diff = await diffRes.json();
  const sarif = sarifRes.ok ? await sarifRes.json() : null;

  const gate = evaluateGate(diff, input);
  const summary = buildSummary(diff, gate, annotations);
  return { exitCode: gate.failed ? 1 : 0, diff, sarif, summary, annotations };
}

function evaluateGate(diff, input) {
  if (diff.mode === "bootstrap") {
    return { failed: false, reason: "bootstrap — first report becomes the baseline" };
  }
  if (diff.mode === "no_reports") {
    return { failed: false, reason: "no canonical reports yet" };
  }
  if (diff.mode === "chain_broken") {
    // tamper signal, not a regression — loud warning, never a fake pass
    return { failed: false, reason: "chain_broken — base report not found; verify site history" };
  }
  if (diff.ruleset_compatible === false) {
    return { failed: false, reason: "ruleset changed — scores not comparable" };
  }
  // min_score is an independent floor — it applies under every
  // fail_on mode including "none" (a floor is not a diff condition)
  if (input.minScore > 0 && (diff.head_scores?.readiness ?? 100) < input.minScore) {
    return {
      failed: true,
      reason: `readiness ${diff.head_scores?.readiness} below min_score ${input.minScore}`,
    };
  }
  if (input.failOn === "none") return { failed: false, reason: "fail_on=none" };
  if (input.failOn === "new_finding" && diff.new_findings.length > 0) {
    return { failed: true, reason: `${diff.new_findings.length} new finding(s): ${diff.new_findings.join(", ")}` };
  }
  if (
    input.failOn === "score_drop" &&
    ((diff.score_delta.readiness ?? 0) < 0 || (diff.score_delta.exposure ?? 0) < 0)
  ) {
    return {
      failed: true,
      reason:
        `score dropped (readiness ${fmt(diff.score_delta.readiness)}, ` +
        `exposure ${fmt(diff.score_delta.exposure)})`,
    };
  }
  return { failed: false, reason: "gate satisfied" };
}

function buildSummary(diff, gate, annotations) {
  const lines = [
    `mode=${diff.mode} gate=${gate.failed ? "FAIL" : "PASS"} — ${gate.reason}`,
    `readiness=${diff.head_scores?.readiness ?? "n/a"} exposure=${diff.head_scores?.exposure ?? "n/a"}`,
    `new=${diff.new_findings.length} closed=${diff.closed_findings.length} still_open=${diff.still_open.length}`,
  ];
  for (const a of annotations) lines.push(`${a.level}: ${a.message}`);
  return lines.join("\n");
}

const fmt = (n) => (n === null || n === undefined ? "n/a" : String(n));

async function err(res, what) {
  const body = await res.json().catch(() => ({}));
  return `${what} failed: HTTP ${res.status} ${body.error ?? ""} ${body.message ?? ""}`.trim();
}

const fail = (message) => ({
  exitCode: 2,
  diff: null,
  sarif: null,
  summary: `action error: ${message}`,
  annotations: [{ level: "error", message }],
});
