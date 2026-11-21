import { describe, expect, it } from "vitest";
import {
  assertHttp, checkEvent, findEventByRequestId, pollEvent,
  type EventRow,
} from "../../scripts/probe-bot/src/verify";

const ev = (payload: unknown): EventRow => ({ payload });

describe("assertHttp", () => {
  it("pass при статусе в expect", () => {
    const r = assertHttp(
      { status: 404, requestId: "r1", bodySnippet: "" },
      { statusIn: [400, 404], statusNotIn: [500] },
    );
    expect(r.verdict).toBe("pass");
  });

  it("fail на 5xx в deny-сете", () => {
    const r = assertHttp(
      { status: 500, requestId: "r1", bodySnippet: "" },
      { statusIn: [400, 404], statusNotIn: [500] },
    );
    expect(r.verdict).toBe("fail");
    expect(r.note).toContain("500");
  });

  it("fail на утечке в теле (bodyNotIncludes)", () => {
    const r = assertHttp(
      { status: 500, requestId: "r", bodySnippet: '{"error":"rpc.blockdaemon mainnet"}' },
      { statusIn: [200, 500], bodyNotIncludes: ["blockdaemon"] },
    );
    expect(r.verdict).toBe("fail");
    expect(r.note).toContain("blockdaemon");
  });

  it("inconclusive без ответа (timeout/throw)", () => {
    const r = assertHttp(
      { status: null, requestId: null, bodySnippet: "", error: "timeout" },
      { statusIn: [200] },
    );
    expect(r.verdict).toBe("inconclusive");
  });
});

describe("dbVerify: requestId → event", () => {
  const events = [
    ev({ requestId: "aaa", status: "404", path: "/a", ua: "AgentBadge-ProbeBot/0.1" }),
    ev({ requestId: "bbb", status: "500", path: "/b" }),
    ev("not-an-object"),
  ];

  it("находит событие по requestId, игнорируя битые payload'ы", () => {
    expect(findEventByRequestId(events, "bbb")?.payload).toMatchObject({ status: "500" });
    expect(findEventByRequestId(events, "zzz")).toBeNull();
  });

  it("checkEvent: match/mismatch/missing", () => {
    expect(checkEvent(events[0], 404).verdict).toBe("match");
    expect(checkEvent(events[0], 400).verdict).toBe("mismatch");
    expect(checkEvent(null, 404).verdict).toBe("missing");
  });

  it("pollEvent: ждёт появления события, отдаёт null по таймауту", async () => {
    let calls = 0;
    const lister = async () => (++calls > 2 ? events : []);
    const hit = await pollEvent(lister, "t0", "aaa", { timeoutMs: 2000, intervalMs: 10 });
    expect(hit).not.toBeNull();
    expect(calls).toBeGreaterThan(1);

    const miss = await pollEvent(async () => [], "t0", "none", { timeoutMs: 50, intervalMs: 10 });
    expect(miss).toBeNull();
  });
});
