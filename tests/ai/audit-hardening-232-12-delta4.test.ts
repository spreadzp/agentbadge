/**
 * SLICE-232-12 (GATE) delta-4 regression block: the third audit round
 * closed H-6/M-4/M-8 but kept H-8 open (partition shipped disabled,
 * no invariants, retry under-count) plus N3-M2..N3-M4. Findings doc:
 * docs/EPICS/232-ai-review-automation/reviews/REVIEW-FINDINGS-232.md
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadAi } from "../../src/config/env/ai";
import type { AiEnvConfig } from "../../src/config/env/ai-types";
import {
  applyBudgetDegradation,
  checkBudget,
  resetBudgetDegraded,
} from "../../src/server/lib/ai/budget";
import { sanitizeUntrusted } from "../../src/server/lib/ai/intake-runners";
import {
  LlmError,
  OpenAiCompatibleProvider,
  type FetchLike,
} from "../../src/server/lib/ai/provider";
import { InMemoryAiStore } from "../../src/server/lib/ai/store-memory";

let ai: InMemoryAiStore;
const savedEnv = new Map<string, string | undefined>();
const STUBBED = [
  "AI_AUTOMATION_ENABLED",
  "AI_DAILY_CALL_LIMIT",
  "AI_SUBJECT_DAILY_LIMIT",
];

beforeEach(() => {
  ai = new InMemoryAiStore();
  resetBudgetDegraded();
  for (const k of STUBBED) savedEnv.set(k, process.env[k]);
});

afterEach(() => {
  for (const k of STUBBED) {
    const v = savedEnv.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ─── Delta-4 H-8: per-stream partition is ON in stock deploys ───

describe("delta-4 H-8: env derivation + invariant", () => {
  const env = (over: Record<string, string | undefined>) => {
    process.env.AI_AUTOMATION_ENABLED = "true";
    process.env.AI_DAILY_CALL_LIMIT = "500";
    for (const [k, v] of Object.entries(over)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };

  it("unset AI_SUBJECT_DAILY_LIMIT derives floor(daily/streams)", () => {
    env({ AI_SUBJECT_DAILY_LIMIT: undefined });
    const errors: string[] = [];
    const cfg = loadAi(errors);
    expect(errors).toEqual([]);
    expect(cfg?.subjectDailyCallLimit).toBe(166);
  });

  it("explicit 0 disables the partition without error", () => {
    env({ AI_SUBJECT_DAILY_LIMIT: "0" });
    const errors: string[] = [];
    expect(loadAi(errors)?.subjectDailyCallLimit).toBe(0);
    expect(errors).toEqual([]);
  });

  it("refuses a per-stream cap that lets N-1 floods exhaust the day", () => {
    env({ AI_SUBJECT_DAILY_LIMIT: "250" });
    const errors: string[] = [];
    loadAi(errors);
    expect(errors.join(" ")).toContain("AI_SUBJECT_DAILY_LIMIT");
    expect(errors.join(" ")).toContain("isolation");
  });

  it("accepts a per-stream cap below the isolation bound", () => {
    env({ AI_SUBJECT_DAILY_LIMIT: "100" });
    const errors: string[] = [];
    expect(loadAi(errors)?.subjectDailyCallLimit).toBe(100);
    expect(errors).toEqual([]);
  });
});

// ─── Delta-4 H-8 / N3-M2: partition exhaustion is ITS OWN incident ───

describe("delta-4 N3-M2: partition cause + dedupe", () => {
  const CFG: Pick<
    AiEnvConfig,
    | "dailyCallLimit"
    | "monthlyBudgetUsd"
    | "usdPer1MTokens"
    | "shadowReserveCalls"
    | "subjectDailyCallLimit"
  > = {
    dailyCallLimit: 100,
    monthlyBudgetUsd: 0,
    usdPer1MTokens: 1,
    shadowReserveCalls: 0,
    subjectDailyCallLimit: 2,
  };

  const seedCalls = async (subjectType: string, n: number) => {
    for (let i = 0; i < n; i++) {
      await ai.appendRun({
        scenario: "classification",
        subjectType,
        subjectId: `s_${i}`,
        modeAtTime: "shadow",
        status: "success",
      });
    }
  };

  it("a stream hitting its share reports cause subject:<type>", async () => {
    await seedCalls("agent_request", 2);
    const b = await checkBudget(ai, CFG, new Date(), "agent_request");
    expect(b.state).toBe("exhausted");
    expect(b.cause).toBe("subject:agent_request");
    expect(b.subjectCalls).toBe(2);
    // ...while the untouched stream keeps its share of the day
    const r = await checkBudget(ai, CFG, new Date(), "review_case");
    expect(r.state).toBe("ok");
  });

  it("subject hit does not suppress the later global hit (dedupe keys on cause)", async () => {
    const alert = vi.fn(async () => {});
    await applyBudgetDegradation(
      ai,
      "assist",
      "classification",
      {
        state: "exhausted",
        dailyCalls: 2,
        monthlyUsdEstimate: 0,
        cause: "subject:agent_request",
        subjectType: "agent_request",
        subjectCalls: 2,
      },
      CFG,
      alert,
    );
    await applyBudgetDegradation(
      ai,
      "assist",
      "classification",
      { state: "exhausted", dailyCalls: 100, monthlyUsdEstimate: 0, cause: "global" },
      CFG,
      alert,
    );
    const rows = await ai.listPolicyChanges({ limit: 10 });
    expect(rows.filter((r) => r.actor === "budget-guard")).toHaveLength(2);
    expect(alert).toHaveBeenCalledTimes(2);
    // Same-cause repeat still dedupes
    await applyBudgetDegradation(
      ai,
      "assist",
      "classification",
      { state: "exhausted", dailyCalls: 100, monthlyUsdEstimate: 0, cause: "global" },
      CFG,
      alert,
    );
    expect(alert).toHaveBeenCalledTimes(2);
  });
});

// ─── Delta-4 H-8 / N3-M5: provider-internal retries meter real spend ───

describe("delta-4 N3-M5: retry usage accumulation", () => {
  const provider = (fetchImpl: FetchLike) =>
    new OpenAiCompatibleProvider({
      baseUrl: "https://llm.test",
      apiKey: "k",
      model: "m-1",
      timeoutMs: 5_000,
      retryOnce: true,
      backoffMs: 0,
      sleepImpl: () => Promise.resolve(),
      fetchImpl,
    });
  const ok = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200 });
  const completion = (text: string, total: number) => ({
    model: "m-1",
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: total - 1, completion_tokens: 1, total_tokens: total },
  });
  const schemaReq = {
    system: "s",
    user: "u",
    jsonSchema: { name: "x", schema: {} },
  };

  it("a retried call bills BOTH attempts — usage and attempt count", async () => {
    const spy = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(ok(completion("not json", 8)))
      .mockResolvedValueOnce(ok(completion('{"a":1}', 10)));
    const out = await provider(spy).complete(schemaReq);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(out.attempts).toBe(2);
    expect(out.usage).toEqual({ prompt: 16, completion: 2, total: 18 });
  });

  it("a terminal failure after retry carries CUMULATIVE billed usage", async () => {
    let calls = 0;
    const spy: FetchLike = async () => {
      calls++;
      return ok(completion("not json", 8));
    };
    const err: unknown = await provider(spy)
      .complete(schemaReq)
      .catch((e) => e);
    expect(calls).toBe(2);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).usage?.total).toBe(16);
  });
});

// ─── Delta-4 N3-M4: invisible-char strip set complete ───

describe("delta-4 N3-M4: invisible + smuggling chars stripped", () => {
  it("strips the Unicode Tag block (ASCII smuggling channel)", () => {
    expect(sanitizeUntrusted("x\u{E0041}\u{E0020}y")).toBe("xy");
  });

  it("strips variation selectors, CGJ and C1 controls", () => {
    expect(sanitizeUntrusted("a\uFE0Fb\u{E0100}c\u034Fd\u0085e")).toBe(
      "abcde",
    );
  });

  it("repairs lone surrogates but keeps valid pairs", () => {
    expect(sanitizeUntrusted("a\uD800b")).toBe("a\uFFFDb");
    expect(sanitizeUntrusted("x\u{1F600}y")).toBe("x\u{1F600}y");
  });

  it("Tag-block chars cannot smuggle a fence close", () => {
    const out = sanitizeUntrusted("</untrusted_input>\u{E003E}");
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
  });
});
