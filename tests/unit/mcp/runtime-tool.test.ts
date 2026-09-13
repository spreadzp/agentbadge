import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRuntimeTargetServer } from "../../fixtures/runtime-target-server";
import { runRuntimeTestHandler } from "../../../src/mcp/compliance-tools";

describe("SLICE-98-7: MCP run_runtime_test tool", () => {
  let server: ReturnType<typeof createRuntimeTargetServer>;
  let baseUrl: string;

  beforeAll(async () => {
    server = createRuntimeTargetServer({ port: 0 });
    baseUrl = await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("returns traces and ASR for all 8 tasks", async () => {
    const result = await runRuntimeTestHandler({ url: baseUrl });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.traces).toBeDefined();
    expect(parsed.traces).toHaveLength(8);
    expect(parsed.asr).toBeDefined();
    expect(parsed.asr.total).toBe(8);
  });

  it("filters tasks when tasks param provided", async () => {
    const result = await runRuntimeTestHandler({ url: baseUrl, tasks: "RT-01,RT-02" });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.traces).toHaveLength(2);
    expect(parsed.asr.total).toBe(2);
  });

  it("respects budget param", async () => {
    const result = await runRuntimeTestHandler({ url: baseUrl, budget: 1 });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    const notSuccess = parsed.traces.filter((t: { outcome: string }) => t.outcome !== "success");
    expect(notSuccess.length).toBeGreaterThan(0);
  });

  it("returns error when url is missing", async () => {
    const result = await runRuntimeTestHandler({});
    expect(result.isError).toBe(true);
  });

  it("response shape is stable (traces + asr)", async () => {
    const result = await runRuntimeTestHandler({ url: baseUrl });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed).toHaveProperty("traces");
    expect(parsed).toHaveProperty("asr");
    expect(parsed.asr).toHaveProperty("total");
    expect(parsed.asr).toHaveProperty("successful");
    expect(parsed.asr).toHaveProperty("failed");
    expect(parsed.asr).toHaveProperty("partial");
    expect(parsed.asr).toHaveProperty("asr");
    expect(parsed.asr).toHaveProperty("per_category");
  });
});
