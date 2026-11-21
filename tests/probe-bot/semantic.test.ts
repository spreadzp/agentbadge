/**
 * SLICE-234-40 — семантический слой: expect.json.*, re: в
 * bodyNotIncludes, contract-подстановки, flow-исполнение.
 */
import { describe, expect, it } from "vitest";
import {
  assertHttp, checkSchemaLite, getPath,
} from "../../scripts/probe-bot/src/verify";
import {
  caseToken, contractBody, loadPayloadFile, loadScenarios,
  substituteTokens,
} from "../../scripts/probe-bot/src/scenarios";
import { endpointsFromRegistry, mergeContracts } from "../../scripts/probe-bot/src/inventory";
import { runProbes } from "../../scripts/probe-bot/src/runner";
import { ProbeState } from "../../scripts/probe-bot/src/state";
import type { Endpoint, Scenario } from "../../scripts/probe-bot/src/types";

const obs = (over: Partial<Parameters<typeof assertHttp>[0]> = {}) => ({
  status: 200, requestId: "r", bodySnippet: "", ...over,
});

describe("getPath", () => {
  const o = { a: { b: [{ c: 5 }] }, flat: "v", "x.y": 1 };
  it("dot-пути и индексы", () => {
    expect(getPath(o, "a.b[0].c")).toBe(5);
    expect(getPath(o, "$.flat")).toBe("v");
    expect(getPath(o, "a.b[1]")).toBeUndefined();
    expect(getPath(o, "nope.deep")).toBeUndefined();
  });
});

describe("expect.json.*", () => {
  const body = { requestId: "rq1", status: "PENDING", nested: { leak: "x" } };
  const o = { ...obs(), bodyJson: body };

  it("present: pass когда путь существует, fail когда нет", () => {
    expect(assertHttp(o, { statusIn: [200], json: { present: ["requestId", "nested.leak"] } }).verdict).toBe("pass");
    const r = assertHttp(o, { statusIn: [200], json: { present: ["missing"] } });
    expect(r.verdict).toBe("fail");
    expect(r.note).toContain("missing");
  });

  it("absent: fail на denylist-поле (projection leak)", () => {
    const r = assertHttp(o, { statusIn: [200], json: { absent: ["nested.leak", "nope"] } });
    expect(r.verdict).toBe("fail");
    expect(r.note).toContain("nested.leak");
    expect(assertHttp(o, { statusIn: [200], json: { absent: ["nope"] } }).verdict).toBe("pass");
  });

  it("equals: точное совпадение", () => {
    expect(assertHttp(o, { statusIn: [200], json: { equals: { status: "PENDING" } } }).verdict).toBe("pass");
    const r = assertHttp(o, { statusIn: [200], json: { equals: { status: "ANSWERED" } } });
    expect(r.verdict).toBe("fail");
    expect(r.note).toContain("ANSWERED");
  });

  it("regex: значение по пути матчится", () => {
    expect(assertHttp(o, { statusIn: [200], json: { regex: { requestId: "^rq" } } }).verdict).toBe("pass");
    expect(assertHttp(o, { statusIn: [200], json: { regex: { requestId: "^xx" } } }).verdict).toBe("fail");
  });

  it("non-JSON body с json-asserts → fail, а не crash", () => {
    const r = assertHttp({ ...obs(), bodyJson: undefined, bodySnippet: "<html>" },
      { statusIn: [200], json: { present: ["x"] } });
    expect(r.verdict).toBe("fail");
    expect(r.note).toContain("not JSON");
  });

  it("schema-lite: required + shallow types", () => {
    const schema = { required: ["requestId"], props: { status: "string", count: "number" } };
    expect(checkSchemaLite(body, schema)).toEqual([]);
    expect(checkSchemaLite({ status: "PENDING" }, schema)[0]).toContain("requestId");
    expect(checkSchemaLite({ requestId: "r", status: 5 }, schema)[0]).toContain("status");
  });
});

describe("bodyNotIncludes re:", () => {
  it("re:-паттерн ловит утечку, литерал — как раньше", () => {
    const r = assertHttp(
      { ...obs(), status: 200, bodySnippet: "TypeError: x is not a function" },
      { statusIn: [200], bodyNotIncludes: ["re:TypeError:|ReferenceError:"] },
    );
    expect(r.verdict).toBe("fail");
    const ok = assertHttp(
      { ...obs(), status: 200, bodySnippet: "all good" },
      { statusIn: [200], bodyNotIncludes: ["re:TypeError:", "secret"] },
    );
    expect(ok.verdict).toBe("pass");
  });
});

describe("contract подстановки", () => {
  it("substituteTokens заменяет {case_key}/{run_id}/{ts} рекурсивно", () => {
    const out = substituteTokens(
      { a: "k-{case_key}", b: ["{run_id}", 5], c: { d: "{ts}" } },
      { case_key: "CK", run_id: "RN", ts: "99" },
    ) as { a: string; b: unknown[]; c: { d: string } };
    expect(out.a).toBe("k-CK");
    expect(out.b).toEqual(["RN", 5]);
    expect(out.c.d).toBe("99");
  });

  it("caseToken стабилен и per-scenario различен", () => {
    const ep: Endpoint = { path: "/p", method: "POST", source: "manual" };
    expect(caseToken(ep, "s1")).toBe(caseToken(ep, "s1"));
    expect(caseToken(ep, "s1")).not.toBe(caseToken(ep, "s2"));
    expect(caseToken(ep, "s1")).toMatch(/^pb[0-9a-f]{10}$/);
  });

  it("contractBody подставляет токены и возвращает JSON", () => {
    const ep: Endpoint = {
      path: "/p", method: "POST", source: "manual",
      contract: { bodyTemplate: { text: "hi {case_key}", ctx: { s: "{run_id}" } } },
    };
    const b = JSON.parse(contractBody(ep, "sc", { runId: "r1" })!) as { text: string; ctx: { s: string } };
    expect(b.text).toMatch(/^hi pb[0-9a-f]{10}$/);
    expect(b.ctx.s).toBe("r1");
  });
});

describe("contract-aware yaml-шаблоны", () => {
  const epC: Endpoint = {
    path: "/api/v1/agent/interaction", method: "POST", source: "manual",
    contract: {
      bodyTemplate: { type: "question", text: "t {case_key}", context: { sessionId: "s" } },
      idempotencyField: "header:idempotency-key",
    },
  };

  it("contract-submit → валидное POST-тело из bodyTemplate", async () => {
    const scs = await loadScenarios();
    const sc = scs.find(s => s.name === "contract-submit")!;
    const vs = await sc.variants(epC, { runId: "r" });
    expect(vs).toHaveLength(1);
    const b = JSON.parse(vs[0].body!) as { type: string };
    expect(b.type).toBe("question");
    // без contract — не применяется (applies=false, пустых кейсов нет)
    expect(sc.applies({ path: "/x", method: "POST", source: "manual" })).toBe(false);
    expect(await sc.variants({ path: "/x", method: "POST", source: "manual" }, { runId: "r" })).toHaveLength(0);
  });

  it("negative-contract → per-field мутации", async () => {
    const sc = (await loadScenarios()).find(s => s.name === "negative-contract")!;
    const vs = await sc.variants(epC, { runId: "r" });
    // 3 поля × (null + type-flip) + 3 поля × drop = 9
    expect(vs).toHaveLength(9);
    const bodies = vs.map(v => JSON.parse(v.body!) as Record<string, unknown>);
    expect(bodies.some(b => b.text === null)).toBe(true);
    expect(bodies.some(b => b.text === 12345)).toBe(true);
    expect(bodies.some(b => !("type" in b))).toBe(true);
  });

  it("mass-assignment → привилегированные поля внедрены", async () => {
    const sc = (await loadScenarios()).find(s => s.name === "mass-assignment")!;
    const vs = await sc.variants(epC, { runId: "r" });
    const b = JSON.parse(vs[0].body!) as Record<string, unknown>;
    expect(b.admin).toBe(true);
    expect(b.role).toBe("admin");
    expect(vs[0].expect.statusNotIn).toContain(500);
  });

  it("ignored-auth → forged creds заголовки", async () => {
    const sc = (await loadScenarios()).find(s => s.name === "ignored-auth")!;
    const vs = await sc.variants(epC, { runId: "r" });
    expect(vs[0].headers?.authorization).toBe("Bearer probe-forged-admin-token");
    expect(vs[1].headers?.["x-admin-key"]).toBe("probe-forged-key");
    // idempotency-header из contract пришивается ко всем сабмитам
    expect(vs[0].headers?.["idempotency-key"]).toMatch(/^BOT-PROBE-/);
  });

  it("unsupported-method → webdav методы из feed-файла", async () => {
    const sc = (await loadScenarios()).find(s => s.name === "unsupported-method")!;
    const vs = await sc.variants({ path: "/x", method: "GET", source: "manual" });
    const ms = vs.map(v => v.method);
    expect(ms).toContain("PROPFIND");
    expect(ms).toContain("TRACE");
    expect(ms.length).toBeGreaterThanOrEqual(10);
    expect(vs[0].expect.statusNotIn).toContain(500);
  });

  it("path-feed (endpoint-discovery) → абсолютные пути из файла", async () => {
    const sc = (await loadScenarios()).find(s => s.name === "endpoint-discovery")!;
    const root: Endpoint = { path: "/", method: "GET", source: "manual" };
    expect(sc.applies(root)).toBe(true);
    const vs = await sc.variants(root);
    expect(vs.length).toBeGreaterThan(30);
    expect(vs.map(v => v.path)).toContain("/.env");
    expect(vs[0].expect.statusIn).not.toContain(200);
  });

  it("jwt-games → malformed bearer заголовки", async () => {
    const sc = (await loadScenarios()).find(s => s.name === "jwt-games")!;
    const ep: Endpoint = { path: "/admin/api", method: "GET", source: "manual" };
    expect(sc.applies(ep)).toBe(true);
    const vs = await sc.variants(ep);
    expect(vs.length).toBeGreaterThanOrEqual(5);
    expect(vs.every(v => v.headers?.authorization?.startsWith("Bearer "))).toBe(true);
  });

  it("values_file мерджится с values (nul-control)", async () => {
    const sc = (await loadScenarios()).find(s => s.name === "nul-control")!;
    const vs = await sc.variants({ path: "/e", method: "GET", source: "manual" });
    const paths = vs.map(v => v.path);
    expect(paths).toContain("/e/%00");         // inline value
    expect(paths).toContain("/e/%0a%0d");       // из feed-файла
    expect(vs.length).toBeGreaterThanOrEqual(15);
  });
});

describe("registry contracts", () => {
  it("registry парсит contract-блоки; mergeContracts шьёт на совпадения", () => {
    const reg = endpointsFromRegistry();
    const interaction = reg.find(e => e.path === "/api/v1/agent/interaction");
    expect(interaction?.contract?.idempotencyField).toBe("header:idempotency-key");
    expect(interaction?.contract?.projectionDenylist).toContain("context.text");

    const merged = mergeContracts([
      { path: "/api/v1/agent/interaction", method: "POST", source: "openapi" },
      ...reg,
    ]);
    const openapiEp = merged.find(e => e.path === "/api/v1/agent/interaction" && e.source === "openapi");
    expect(openapiEp?.contract?.idempotencyField).toBe("header:idempotency-key");
  });
});

/** In-memory ProbeState-стаб для vitest (bun:sqlite тут недоступен). */
function fakeState(): ProbeState {
  const cases = new Map<string, { verdict: string; last_status: number | null }>();
  return {
    ensureCase: (c: { case_key: string }) => {
      if (!cases.has(c.case_key)) cases.set(c.case_key, { verdict: "new", last_status: null });
      return cases.get(c.case_key)!.verdict;
    },
    getCase: (k: string) => cases.get(k) ?? null,
    recordResult: (k: string, r: { verdict: string; status: number | null }) => {
      cases.set(k, { verdict: r.verdict, last_status: r.status });
    },
    startRun: () => {},
    endRun: () => {},
    close: () => {},
  } as unknown as ProbeState;
}

describe("flow-исполнение", () => {
  const flowScenario: Scenario = {
    name: "flow-test", layer: "contract", dbVerify: false, mutating: false,
    applies: ep => ep.path === "/submit",
    variants: ep => [{
      method: "POST", path: ep.path,
      expect: { statusIn: [200, 201, 202, 404] },
      flow: {
        steps: [
          { method: "POST", path: ep.path, body: "{}", note: "submit" },
          { method: "GET", path: "/status/{step1.id}", note: "read" },
        ],
        assert: obs =>
          getPath(obs[1]?.bodyJson, "ref") === "req-7" ? [] : ["ref mismatch"],
      },
    }],
  };

  it("шаги исполняются последовательно, {stepN.x} подставляется", async () => {
    const calls: string[] = [];
    const state = fakeState();
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push(u);
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ id: "req-7" }),
          { status: 202, headers: { "x-request-id": "r1", "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ref: "req-7", status: "ok" }),
        { status: 200, headers: { "x-request-id": "r2", "content-type": "application/json" } });
    }) as typeof fetch;

    const sum = await runProbes({
      target: "http://localhost:9",
      endpoints: [{ path: "/submit", method: "POST", source: "manual" }],
      scenarios: [flowScenario],
      maxRequests: 10, rps: 100, state, fetchFn,
      sleep: async () => {},
    });
    expect(sum.counts.pass).toBe(1);
    expect(calls[0]).toBe("http://localhost:9/submit");
    expect(calls[1]).toBe("http://localhost:9/status/req-7");
    state.close();
  });

  it("flow.assert проблемы → fail; step-fail обрывает флоу", async () => {
    const state = fakeState();
    const fetchFn = (async (_u: string | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response("{}", { status: 202, headers: { "x-request-id": "r" } })
        : new Response("{}", { status: 500, headers: { "x-request-id": "r2" } })
    ) as typeof fetch;
    const sum = await runProbes({
      target: "http://localhost:9",
      endpoints: [{ path: "/submit", method: "POST", source: "manual" }],
      scenarios: [flowScenario], maxRequests: 10, rps: 100,
      state, fetchFn, sleep: async () => {},
    });
    expect(sum.counts.fail).toBe(1);
    expect(sum.results[0].note).toContain("step2");
    state.close();
  });
});

describe("payloads", () => {
  it("feed-файлы читаются, комментарии скипаются", () => {
    const v = loadPayloadFile("http-methods-webdav.txt");
    expect(v).toContain("PROPFIND");
    expect(v.every(x => !x.startsWith("#"))).toBe(true);
    expect(loadPayloadFile("nonexistent.txt")).toEqual([]);
  });
});
