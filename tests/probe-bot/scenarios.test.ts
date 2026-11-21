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
      "headers-audit", "contract-basic", "burst-429", "replay-idem"]) {
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

  it("невалидный template → ошибка при генерации вариантов", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sc-"));
    writeFileSync(join(dir, "bad.yaml"), "name: bad\ntemplate: nonexistent\n");
    const [s] = await loadScenarios(dir);
    expect(() => s.variants(ep())).toThrow(/unknown template/);
  });
});
