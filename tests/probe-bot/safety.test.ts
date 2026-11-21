import { describe, expect, it } from "vitest";
import { applySafety, checkTarget, isHardDenied, normalizeTarget, type PlanItem } from "../../scripts/probe-bot/src/safety";

const item = (over: Partial<PlanItem> = {}): PlanItem => ({
  caseKey: "k", endpoint: "/e", method: "GET", scenario: "s",
  layer: "security", mutating: false, dbVerify: false, variantHash: "vh",
  variant: { method: "GET", path: "/e" },
  ...over,
});

describe("checkTarget", () => {
  it("пускает дефолтные хосты, блокирует чужие", () => {
    expect(checkTarget("https://agentbadge.xyz").ok).toBe(true);
    expect(checkTarget("http://localhost:3000").ok).toBe(true);
    expect(checkTarget("https://evil.example.com").ok).toBe(false);
    expect(checkTarget("ftp://agentbadge.xyz").ok).toBe(false);
    expect(checkTarget("not-a-url").ok).toBe(false);
  });

  it("extraAllowed расширяет список", () => {
    const r = checkTarget("https://staging.agentbadge.xyz", ["staging.agentbadge.xyz"]);
    expect(r.ok).toBe(true);
  });
});

describe("normalizeTarget", () => {
  it("алиасы local↔prod разрешаются в URL", () => {
    expect(normalizeTarget("prod")).toBe("https://agentbadge.xyz");
    expect(normalizeTarget("LOCAL")).toMatch(/^http:\/\/localhost:\d+$/);
    expect(normalizeTarget("https://staging.example.com")).toBe("https://staging.example.com");
    expect(checkTarget("prod").ok).toBe(true);
    expect(checkTarget("local").ok).toBe(true);
  });
});

describe("isHardDenied", () => {
  it("платёжные/settlement пути всегда отклонены", () => {
    for (const p of ["/api/payments/x", "/admin/settlement/intents/1/mark-paid",
      "/admin/finance/payments", "/api/passport/request"]) {
      expect(isHardDenied(p)).toBe(true);
    }
    expect(isHardDenied("/api/ledger/events/1")).toBe(false);
  });
});

describe("applySafety", () => {
  it("mutating без флага — skip; с флагом — fire", () => {
    const plan = [item({ mutating: true }), item()];
    const noFlag = applySafety(plan, { allowMutations: false, maxRequests: 100 });
    expect(noFlag.fire).toHaveLength(1);
    expect(noFlag.skipped[0].skippedReason).toContain("mutating");
    const withFlag = applySafety(plan, { allowMutations: true, maxRequests: 100 });
    expect(withFlag.fire).toHaveLength(2);
  });

  it("hard-deny режет даже mutating-allowed", () => {
    const plan = [item({ mutating: true, variant: { method: "POST", path: "/api/payments/x" } })];
    const r = applySafety(plan, { allowMutations: true, maxRequests: 100 });
    expect(r.fire).toHaveLength(0);
    expect(r.skipped[0].skippedReason).toBe("hard-deny path");
  });

  it("бюджет: max-requests обрезает план с предупреждением", () => {
    const plan = Array.from({ length: 10 }, () => item());
    const r = applySafety(plan, { allowMutations: false, maxRequests: 3 });
    expect(r.fire).toHaveLength(3);
    expect(r.abortedReasons[0]).toContain("max-requests");
  });
});
