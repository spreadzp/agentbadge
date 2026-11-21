import { describe, expect, it } from "vitest";
import { ProbeState, caseKey, variantHash } from "../../scripts/probe-bot/src/state";

const mk = () => ProbeState.open(":memory:")!;
// bun:sqlite доступен только под bun-runtime; под node/vitest — skip
// (как в agent-wallet approvals-sqlite).
const HAS_SQLITE = ProbeState.open(":memory:") != null;

const T = "https://agentbadge.xyz";
const mkBase = (over: Partial<Parameters<typeof caseKey>[0]> = {}) => ({
  locus: "local", target: T, endpoint: "/x", method: "GET",
  scenario: "s", variantHash: "v", ...over,
});

describe.skipIf(!HAS_SQLITE)("ProbeState", () => {
  it("case_key включает locus и target — разные vantage/target = разные кейсы", () => {
    const a = caseKey(mkBase());
    const b = caseKey(mkBase({ locus: "vps-nl" }));
    const c = caseKey(mkBase({ target: "http://localhost:4021" }));
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    // origin-нормализация: trailing slash не меняет ключ
    expect(caseKey(mkBase({ target: "https://agentbadge.xyz/" }))).toBe(a);
  });

  it("variantHash стабилен и различает тела/заголовки", () => {
    const h1 = variantHash({ method: "GET", path: "/a" });
    const h2 = variantHash({ method: "GET", path: "/a", headers: { "x-a": "1" } });
    const h3 = variantHash({ method: "POST", path: "/a", body: "{}" });
    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(h3);
    expect(variantHash({ method: "GET", path: "/a" })).toBe(h1);
  });

  it("ensureCase: новый кейс 'new', повторный — существующий verdict", () => {
    const s = mk();
    const base = {
      case_key: "k1", endpoint: "/e", method: "GET", layer: "security",
      scenario: "nul", variant_hash: "h", expected_json: "{}", locus: "local", target: T,
    };
    expect(s.ensureCase(base)).toBe("new");
    s.recordResult("k1", { verdict: "pass", status: 400, requestId: "r1", note: "" });
    expect(s.ensureCase(base)).toBe("pass");
  });

  it("dedupe: pass-кейс не перевозбуждается, requeue возвращает в new", () => {
    const s = mk();
    s.ensureCase({
      case_key: "k2", endpoint: "/api/x", method: "GET", layer: "security",
      scenario: "nul", variant_hash: "h", expected_json: "{}", locus: "local", target: T,
    });
    s.recordResult("k2", { verdict: "pass", status: 400, requestId: null, note: "" });
    expect(s.listCases({ verdict: "pass" })).toHaveLength(1);
    expect(s.requeue("/api/x")).toBe(1);
    expect(s.getCase("k2")!.verdict).toBe("new");
  });

  it("endpoints: upsert идемпотентен, хранит source", () => {
    const s = mk();
    s.upsertEndpoint({ path: "/a", method: "GET", source: "openapi" });
    s.upsertEndpoint({ path: "/a", method: "GET", source: "openapi" });
    s.upsertEndpoint({ path: "/a", method: "GET", source: "code" });
    const rows = s.listEndpoints();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(r => r.source))).toEqual(new Set(["openapi", "code"]));
  });

  it("countsByVerdict + listCases по фильтрам", () => {
    const s = mk();
    for (const [k, v] of [["a", "fail"], ["b", "pass"], ["c", "suspect"]] as const) {
      s.ensureCase({
        case_key: k, endpoint: "/e" + k, method: "GET", layer: "security",
        scenario: "s", variant_hash: "h", expected_json: "{}", locus: "local", target: T,
      });
      s.recordResult(k, { verdict: v, status: 500, requestId: null, note: "" });
    }
    expect(s.countsByVerdict()).toMatchObject({ fail: 1, pass: 1, suspect: 1 });
    expect(s.listCases({ verdict: "fail" })).toHaveLength(1);
  });
});
