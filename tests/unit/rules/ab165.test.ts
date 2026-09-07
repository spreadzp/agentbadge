import { describe, it, expect } from "vitest";
import { AB165 } from "../../../src/agent-readiness/rules/AB165";
import { SEMANTIC_CHECKERS } from "../../../src/agent-readiness/rule-engine/semantic-checkers";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

function mockSnap(overrides: Partial<ResponseSnapshot> = {}): ResponseSnapshot {
  return {
    url: "https://example.com/agents.json",
    status: 200,
    headers: {},
    body: "",
    bodyHash: null,
    resolvedIp: null,
    fetchTimeMs: 0,
    timestamp: new Date().toISOString(),
    ...overrides,
  } as ResponseSnapshot;
}

describe("AB-165: Agent feeds (JSON Feed 1.1 / RSS 2.0)", () => {
  describe("Rule definition", () => {
    it("has correct rule_id", () => {
      expect(AB165.rule_id).toBe("AB-165");
    });

    it("uses semantic_validation check type", () => {
      expect(AB165.check.type).toBe("semantic_validation");
    });

    it("has agent_feeds source", () => {
      expect(AB165.check.sources).toContain("agent_feeds");
    });

    it("has agent_feeds semantic checker id", () => {
      expect((AB165.check as { semantic: string }).semantic).toBe("agent_feeds");
    });

    it("is counted in score", () => {
      expect(AB165.counted_in_score).toBe(true);
    });

    it("has discovery category", () => {
      expect(AB165.category).toBe("discovery");
    });
  });

  describe("Checker: agent_feeds", () => {
    it("checker is registered in SEMANTIC_CHECKERS", () => {
      expect(SEMANTIC_CHECKERS["agent_feeds"]).toBeDefined();
      expect(typeof SEMANTIC_CHECKERS["agent_feeds"]).toBe("function");
    });

    it("returns 'found' for valid JSON Feed 1.1", () => {
      const snap = mockSnap({
        status: 200,
        body: JSON.stringify({
          version: "https://jsonfeed.org/version/1.1",
          title: "Agent Tasks",
          items: [
            { id: "task-1", title: "New task" },
            { id: "task-2", title: "Another task" },
          ],
        }),
      });
      const result = SEMANTIC_CHECKERS["agent_feeds"]({ agent_feeds: snap });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("JSON Feed");
      expect(result.detail).toContain("2");
    });

    it("returns 'found' for valid RSS 2.0", () => {
      const snap = mockSnap({
        status: 200,
        body: `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Agent Jobs</title>
    <item><title>Job 1</title></item>
    <item><title>Job 2</title></item>
  </channel>
</rss>`,
      });
      const result = SEMANTIC_CHECKERS["agent_feeds"]({ agent_feeds: snap });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("RSS 2.0");
      expect(result.detail).toContain("2");
    });

    it("returns 'partial' for JSON with version field but not jsonfeed.org URL", () => {
      const snap = mockSnap({
        status: 200,
        body: JSON.stringify({
          version: "https://example.com/feed/1.0",
          items: [],
        }),
      });
      const result = SEMANTIC_CHECKERS["agent_feeds"]({ agent_feeds: snap });
      expect(result.outcome).toBe("partial");
      expect(result.detail).toContain("version");
    });

    it("returns 'partial' for non-feed JSON (no version field)", () => {
      const snap = mockSnap({
        status: 200,
        body: JSON.stringify({ tasks: [], message: "hello" }),
      });
      const result = SEMANTIC_CHECKERS["agent_feeds"]({ agent_feeds: snap });
      expect(result.outcome).toBe("partial");
      expect(result.detail).toContain("not a valid");
    });

    it("returns 'partial' for XML without rss/channel", () => {
      const snap = mockSnap({
        status: 200,
        body: '<?xml version="1.0"?><data><item>test</item></data>',
      });
      const result = SEMANTIC_CHECKERS["agent_feeds"]({ agent_feeds: snap });
      expect(result.outcome).toBe("partial");
    });

    it("returns 'absent' for HTTP 404", () => {
      const snap = mockSnap({ status: 404, body: "" });
      const result = SEMANTIC_CHECKERS["agent_feeds"]({ agent_feeds: snap });
      expect(result.outcome).toBe("absent");
    });

    it("returns 'absent' for empty body", () => {
      const snap = mockSnap({ status: 200, body: "" });
      const result = SEMANTIC_CHECKERS["agent_feeds"]({ agent_feeds: snap });
      expect(result.outcome).toBe("absent");
    });

    it("returns 'no_source' when agent_feeds snapshot is null", () => {
      const result = SEMANTIC_CHECKERS["agent_feeds"]({ agent_feeds: null });
      expect(result.outcome).toBe("no_source");
    });

    it("returns 'no_source' when agent_feeds key is missing", () => {
      const result = SEMANTIC_CHECKERS["agent_feeds"]({});
      expect(result.outcome).toBe("no_source");
    });
  });
});
