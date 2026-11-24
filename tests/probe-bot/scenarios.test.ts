import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadScenarios, pickScenarios } from "../../scripts/probe-bot/src/scenarios";
import type { Endpoint } from "../../scripts/probe-bot/src/types";

const ep = (over: Partial<Endpoint> = {}): Endpoint => ({
  path: "/api/ledger/events", method: "GET", source: "openapi", ...over,
});

describe("loadScenarios (seed set)", () => {
  it("грузит все seed-сценарии: yaml + ts", async () => {
    const all = await loadScenarios();
    const names = all.map(s => s.name);
    for (const n of ["nul-control", "traversal", "sqli", "bigint-id",
      "unicode-id", "forged-events", "method-fuzz", "malformed-body",
      "headers-audit", "contract-basic", "burst-429", "replay-idem",
      "fts-injection", "no-store-audit", "auth-negative"]) {
      expect(names).toContain(n);
    }
  });

  it("каждый сценарий генерит ≥1 варианта на подходящем endpoint", async () => {
    const all = await loadScenarios();
    const eps = [ep(), ep({ method: "POST" }), ep({ path: "/x" })];
    for (const s of all) {
      const target = eps.find(e => s.applies(e));
      if (!target) continue; // сценарий может не применяться ни к одному фейку
      const vs = await s.variants(target);
      expect(vs.length).toBeGreaterThanOrEqual(1);
      for (const v of vs) {
        expect(v.expect.statusIn?.length ?? 1).toBeGreaterThan(0);
      }
    }
  });

  it("pickScenarios: фильтр по имени и слою, ошибка на неизвестных", async () => {
    const all = await loadScenarios();
    expect(pickScenarios(all, ["nul-control"]).map(s => s.name)).toEqual(["nul-control"]);
    expect(pickScenarios(all, undefined, "contract").every(s => s.layer === "contract")).toBe(true);
    expect(() => pickScenarios(all, ["nope"])).toThrow(/unknown scenarios/);
  });
});

describe("YAML templates", () => {
  it("param-variants добавляет сегменты к пути", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sc-"));
    writeFileSync(join(dir, "t.yaml"), `
name: t
template: param-variants
params: { values: ["%00", "x"] }
apply: { methods: [GET] }
`);
    const [s] = await loadScenarios(dir);
    const vs = await s.variants(ep());
    expect(vs.map(v => v.path)).toEqual(["/api/ledger/events/%00", "/api/ledger/events/x"]);
  });

  it("method-fuzz исключает исходный метод", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sc-"));
    writeFileSync(join(dir, "m.yaml"), `
name: m
template: method-fuzz
params: { methods: [PUT, GET, DELETE] }
`);
    const [s] = await loadScenarios(dir);
    const vs = await s.variants(ep());
    expect(vs.map(v => v.method)).toEqual(["PUT", "DELETE"]);
  });

  it("query-variants строит ?param=<enc> и кодирует значения", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sc-"));
    writeFileSync(join(dir, "q.yaml"), `
name: q
template: query-variants
params: { param: q, values: ["&", "\\x00"] }
apply: { methods: [GET] }
`);
    const [s] = await loadScenarios(dir);
    const vs = await s.variants(ep({ path: "/api/search" }));
    expect(vs.map(v => v.path)).toEqual([
      "/api/search?q=%26", "/api/search?q=%00",
    ]);
  });

  it("query-variants без params.param → ошибка при генерации", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sc-"));
    writeFileSync(join(dir, "q.yaml"), "name: q\ntemplate: query-variants\nparams: { values: [x] }\n");
    const [s] = await loadScenarios(dir);
    expect(() => s.variants(ep())).toThrow(/params\.param/);
  });

  it("невалидный template → ошибка при генерации вариантов", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sc-"));
    writeFileSync(join(dir, "bad.yaml"), "name: bad\ntemplate: nonexistent\n");
    const [s] = await loadScenarios(dir);
    expect(() => s.variants(ep())).toThrow(/unknown template/);
  });
});

describe("payto-proof-surface (258-25)", () => {
  const get = async () =>
    (await loadScenarios()).find(s => s.name === "payto-proof-surface")!;

  it("applies только к двум 258-путям и только GET", async () => {
    const s = await get();
    expect(s.applies(ep({ path: "/.well-known/x402-payto.json" }))).toBe(true);
    expect(s.applies(ep({ path: "/agent-readiness.json" }))).toBe(true);
    expect(s.applies(ep({ path: "/.well-known/x402.json" }))).toBe(false);
    expect(s.applies(ep({ path: "/api/payto", method: "POST" }))).toBe(false);
    expect(s.mutating).toBe(false);
  });

  it("payto flow.assert: ловит domain-mismatch и malformed записи", async () => {
    const s = await get();
    const [v] = await s.variants(
      ep({ path: "/.well-known/x402-payto.json" }),
      { target: "https://agentbadge.xyz" });
    const ok = { version: 1, domain: "agentbadge.xyz",
      payTo: [{ address: "0x" + "a".repeat(40), signature: "0x" + "b".repeat(130) }] };
    expect(v.flow!.assert!([{ status: 200, requestId: null, bodySnippet: "", bodyJson: ok }])).toEqual([]);
    const bad1 = { ...ok, domain: "evil.example" };
    const bad2 = { ...ok, payTo: [{ address: "not-an-address", signature: "0xzz" }] };
    const bad3 = { ...ok, payTo: [] };
    for (const [body, frag] of [[bad1, "domain"], [bad2, "malformed"], [bad3, "non-empty"]] as const) {
      const probs = v.flow!.assert!([{ status: 200, requestId: null, bodySnippet: "", bodyJson: body }]);
      expect(probs.join()).toContain(frag);
    }
  });

  it("showcase flow.assert: требует AB-188/189/190 VERIFIED", async () => {
    const s = await get();
    const [v] = await s.variants(ep({ path: "/agent-readiness.json" }), { target: "https://agentbadge.xyz" });
    const mk = (status: string) => ({
      scan: { status: "ok", assertions: REQUIRED_IDS.map(id => ({ rule_id: id, status })) },
    });
    const REQUIRED_IDS = ["AB-188", "AB-189", "AB-190"];
    expect(v.flow!.assert!([{ status: 200, requestId: null, bodySnippet: "", bodyJson: mk("VERIFIED") }])).toEqual([]);
    const degraded = mk("VERIFIED");
    (degraded.scan.assertions[0] as { status: string }).status = "PARTIAL";
    const probs = v.flow!.assert!([{ status: 200, requestId: null, bodySnippet: "", bodyJson: degraded }]);
    expect(probs.join()).toContain("AB-188");
  });
});
