import { describe, expect, it } from "vitest";
import { lintOrder, parseOrder, validateOrder } from "../../scripts/probe-bot/src/order";

const VALID_YAML = `
target: https://agentbadge.xyz
endpoints: ["/api/ledger/*"]
scenarios: [nul-control]
layer: security
dbVerify: true
deliverTo: session
maxRequests: 60
rps: 2
dryRun: false
allowMutations: false
`;

describe("parseOrder / validateOrder", () => {
  it("валидный yaml заказ", () => {
    const { order, issues } = parseOrder(VALID_YAML);
    expect(issues).toHaveLength(0);
    expect(order?.target).toBe("https://agentbadge.xyz");
    expect(order?.scenarios).toEqual(["nul-control"]);
  });

  it("однострочный JSON (bridge ARG) парсится тем же валидатором", () => {
    const { order, issues } = parseOrder(
      '{"target":"https://agentbadge.xyz","endpoints":["/a"],"scenarios":["s"],"maxRequests":10}',
    );
    expect(issues).toHaveLength(0);
    expect(order?.maxRequests).toBe(10);
  });

  it("ловит ошибки схемы", () => {
    const bad = parseOrder(`
target: 5
unknownField: x
layer: wrong
endpoints: "not-array"
`);
    expect(bad.issues.length).toBeGreaterThanOrEqual(3);
    const fields = bad.issues.map(i => i.field);
    expect(fields).toContain("target");
    expect(fields).toContain("unknownField");
    expect(fields).toContain("layer");
    expect(fields).toContain("endpoints");
  });

  it("не-mapping → issue, мусор → parse error", () => {
    expect(validateOrder([1, 2]).issues[0].field).toBe("<root>");
    expect(parseOrder("{[unclosed").error).toBeTruthy();
  });
});

describe("lintOrder (remote-order safety, D-234-38-Q17)", () => {
  const lint = (o: object, over: object = {}) =>
    lintOrder(o as never, { maxRequestsCap: 200, mutatingRequested: false, ...over });

  it("чистый заказ → auto", () => {
    const d = lint({ target: "https://agentbadge.xyz", maxRequests: 50, rps: 2 });
    expect(d.mode).toBe("auto");
    expect(d.reasons).toHaveLength(0);
  });

  it("чужой хост → queue", () => {
    const d = lint({ target: "https://evil.example.com" });
    expect(d.mode).toBe("queue");
    expect(d.reasons[0]).toContain("target");
  });

  it("бюджет сверх cap → queue; mutating → queue", () => {
    expect(lint({ target: "https://agentbadge.xyz", maxRequests: 500 }).mode).toBe("queue");
    expect(lint({ target: "https://agentbadge.xyz", allowMutations: true }).mode).toBe("queue");
    expect(lint({ target: "https://agentbadge.xyz", rps: 20 }).mode).toBe("queue");
  });
});
