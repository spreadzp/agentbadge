// EPIC-262 (SLICE-262-34): agentbadge/scan-action unit tests — the
// action is a thin wrapper (AC-5); fetch is injected, gate semantics
// are asserted against diff fixtures (mock fetch — no server needed).
import { describe, it, expect } from "vitest";
// @ts-expect-error — plain .mjs module, no types needed for tests
import { runAction } from "../../actions/scan-action/src/core.mjs";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const diff = (over: Record<string, unknown> = {}) => ({
  schema_version: "intel-report-diff/1",
  site_id: "site_1",
  mode: "diff",
  ruleset_compatible: true,
  base_report_id: "r1",
  head_report_id: "r2",
  base_content_hash: "sha256:a",
  head_content_hash: "sha256:b",
  base_ruleset: { name: "wp", version: "1.1.0" },
  head_ruleset: { name: "wp", version: "1.1.0" },
  new_findings: [],
  closed_findings: [],
  still_open: [],
  score_delta: { readiness: 0, exposure: 0 },
  head_scores: { readiness: 80, exposure: 70 },
  generated_at: "2026-11-24T12:00:00Z",
  signature: { algorithm: "ed25519", key_id: "k", value: "s" },
  ...over,
});

const fetchFor = (
  diffBody: unknown,
  opts: { scanStatus?: number; sarifOk?: boolean } = {},
) => {
  const calls: string[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("/scans")) {
      return json({}, opts.scanStatus ?? 201);
    }
    if (url.includes("format=sarif")) {
      return opts.sarifOk === false ? json({}, 500) : json({ version: "2.1.0", runs: [] });
    }
    return json(diffBody);
  };
  return { f: f as typeof fetch, calls };
};

const input = (over: Record<string, unknown> = {}) => ({
  apiBase: "https://api.test",
  siteKey: "absk_test",
  siteId: undefined,
  scan: true,
  failOn: "new_finding" as const,
  minScore: 0,
  ...over,
});

describe("scan-action — gate semantics", () => {
  it("new finding → exit 1 with rule ids named", async () => {
    const { f } = fetchFor(diff({ new_findings: ["AB-4", "AB-7"] }));
    const r = await runAction({ input: input(), fetchImpl: f });
    expect(r.exitCode).toBe(1);
    expect(r.summary).toContain("AB-4");
  });

  it("clean diff → exit 0", async () => {
    const { f } = fetchFor(diff());
    const r = await runAction({ input: input(), fetchImpl: f });
    expect(r.exitCode).toBe(0);
  });

  it("fail_on=none → always exit 0 even with new findings", async () => {
    const { f } = fetchFor(diff({ new_findings: ["AB-4"] }));
    const r = await runAction({
      input: input({ failOn: "none" }),
      fetchImpl: f,
    });
    expect(r.exitCode).toBe(0);
  });

  it("score_drop gate: negative delta fails, zero passes", async () => {
    const { f: failF } = fetchFor(
      diff({ score_delta: { readiness: -5, exposure: 0 } }),
    );
    expect(
      (await runAction({ input: input({ failOn: "score_drop" }), fetchImpl: failF })).exitCode,
    ).toBe(1);
    const { f: passF } = fetchFor(diff());
    expect(
      (await runAction({ input: input({ failOn: "score_drop" }), fetchImpl: passF })).exitCode,
    ).toBe(0);
  });

  it("min_score gate uses head_scores", async () => {
    const { f } = fetchFor(diff({ head_scores: { readiness: 40, exposure: 70 } }));
    const r = await runAction({
      input: input({ failOn: "none", minScore: 60 }),
      fetchImpl: f,
    });
    expect(r.exitCode).toBe(1);
    expect(r.summary).toContain("min_score");
  });

  it("bootstrap → exit 0 with baseline note", async () => {
    const { f } = fetchFor(diff({ mode: "bootstrap", ruleset_compatible: null }));
    const r = await runAction({ input: input(), fetchImpl: f });
    expect(r.exitCode).toBe(0);
    expect(r.summary).toContain("baseline");
  });

  it("chain_broken → exit 0 but loud annotation (tamper ≠ regression)", async () => {
    const { f } = fetchFor(diff({ mode: "chain_broken", ruleset_compatible: null }));
    const r = await runAction({ input: input(), fetchImpl: f });
    expect(r.exitCode).toBe(0);
    expect(r.summary).toContain("chain_broken");
  });

  it("ruleset_compatible:false → exit 0 (not comparable, not faked)", async () => {
    const { f } = fetchFor(diff({ ruleset_compatible: false }));
    const r = await runAction({ input: input(), fetchImpl: f });
    expect(r.exitCode).toBe(0);
  });

  it("scan cooldown 429 → notice, diff still runs, exit reflects gate", async () => {
    const { f, calls } = fetchFor(diff({ new_findings: ["AB-4"] }), {
      scanStatus: 429,
    });
    const r = await runAction({ input: input(), fetchImpl: f });
    expect(r.annotations.some((a: { level: string }) => a.level === "notice")).toBe(true);
    expect(r.exitCode).toBe(1); // gate still evaluated
    expect(calls.some((c) => c.includes("report-diff"))).toBe(true);
  });

  it("scan=false skips POST /scans", async () => {
    const { f, calls } = fetchFor(diff());
    await runAction({ input: input({ scan: false }), fetchImpl: f });
    expect(calls.some((c) => c.includes("/scans"))).toBe(false);
  });

  it("backend error → exit 2 (action error, not a gate result)", async () => {
    const f = (async () =>
      json({ error: "consent_denied" }, 403)) as unknown as typeof fetch;
    const r = await runAction({ input: input({ scan: false }), fetchImpl: f });
    expect(r.exitCode).toBe(2);
    expect(r.summary).toContain("consent_denied");
  });

  it("sarif payload is carried through when backend serves it", async () => {
    const { f } = fetchFor(diff());
    const r = await runAction({ input: input(), fetchImpl: f });
    expect(r.sarif?.version).toBe("2.1.0");
  });
});
