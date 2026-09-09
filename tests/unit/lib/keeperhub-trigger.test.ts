import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockExecuteWorkflow = vi.fn();
const mockClient = {
  executeWorkflow: mockExecuteWorkflow,
} as unknown;

vi.mock("@agentbadge/keeperhub", () => ({
  KeeperHubClient: vi.fn(),
}));

import { triggerWorkflow } from "../../../src/server/lib/keeperhub-trigger";

describe("SLICE-126-10: keeperhub-trigger seam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mcp mode: executeWorkflow called with workflowId + inputs; returns via:'mcp'", async () => {
    mockExecuteWorkflow.mockResolvedValue({ executionId: "exec_123" });

    const result = await triggerWorkflow(
      mockClient as never,
      "wf_1",
      { siteUrl: "https://example.com", score: 85, rulesPassed: 140, rulesTotal: 145 },
      { mode: "mcp" },
    );

    expect(result).toEqual({ executionId: "exec_123", via: "mcp" });
    expect(mockExecuteWorkflow).toHaveBeenCalledWith("wf_1", {
      siteUrl: "https://example.com",
      score: 85,
      rulesPassed: 140,
      rulesTotal: 145,
    });
  });

  it("webhook mode: fetch stubbed → POST with Bearer wfb_, JSON body; ok → executionId from body", async () => {
    const fetchStub = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ executionId: "wh_exec_1" }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchStub);

    const result = await triggerWorkflow(
      mockClient as never,
      "wf_1",
      { siteUrl: "https://example.com", score: 85, rulesPassed: 140, rulesTotal: 145 },
      { mode: "webhook", webhookUrl: "https://kh.example.com/trigger", webhookKey: "wfb_test_key" },
    );

    expect(result).toEqual({ executionId: "wh_exec_1", via: "webhook" });
    expect(fetchStub).toHaveBeenCalledWith(
      "https://kh.example.com/trigger",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer wfb_test_key",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("webhook mode: !ok → throws with status", async () => {
    const fetchStub = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({}),
      text: async () => "validation error",
    });
    vi.stubGlobal("fetch", fetchStub);

    await expect(
      triggerWorkflow(
        mockClient as never,
        "wf_1",
        { siteUrl: "https://example.com", score: 85, rulesPassed: 140, rulesTotal: 145 },
        { mode: "webhook", webhookUrl: "https://kh.example.com/trigger", webhookKey: "wfb_test_key" },
      ),
    ).rejects.toThrow(/Webhook trigger failed: 422/);
  });

  it("mode fallback: mode 'webhook' but no url/key → silently uses mcp", async () => {
    mockExecuteWorkflow.mockResolvedValue({ executionId: "exec_fallback" });

    const result = await triggerWorkflow(
      mockClient as never,
      "wf_1",
      { siteUrl: "https://example.com", score: 85, rulesPassed: 140, rulesTotal: 145 },
      { mode: "webhook" },
    );

    expect(result.via).toBe("mcp");
    expect(mockExecuteWorkflow).toHaveBeenCalled();
  });

  it("SLICE-126-17: webhook 200 but body without executionId → webhook-unknown sentinel", async () => {
    const fetchStub = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchStub);

    const result = await triggerWorkflow(
      mockClient as never,
      "wf_1",
      { siteUrl: "https://example.com", score: 85, rulesPassed: 140, rulesTotal: 145 },
      { mode: "webhook", webhookUrl: "https://kh.example.com/trigger", webhookKey: "wfb_test_key" },
    );

    expect(result.executionId).toBe("webhook-unknown");
    expect(result.via).toBe("webhook");
  });

  it("SLICE-126-17: webhook mode with url+key but fetch network error → throws", async () => {
    const fetchStub = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchStub);

    await expect(
      triggerWorkflow(
        mockClient as never,
        "wf_1",
        { siteUrl: "https://example.com", score: 85, rulesPassed: 140, rulesTotal: 145 },
        { mode: "webhook", webhookUrl: "https://kh.example.com/trigger", webhookKey: "wfb_test_key" },
      ),
    ).rejects.toThrow(/ECONNREFUSED/);
  });
});
