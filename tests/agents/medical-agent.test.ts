import { describe, it, expect, vi } from "vitest";
import { MedicalAgent, type AgentState, type AgentDependencies, type AgentLogEntry } from "../../src/agents/medical-agent";
import { generatePimaSample } from "../../src/agents/analysis/pima-dataset";
import { runAnalysisPipeline } from "../../src/agents/analysis/pipeline";
import type { MedicalAgentConfig, TypedDataset, AnalysisReport, ReportBundle } from "../../src/agents/types";

const CONFIG: MedicalAgentConfig = {
  did: "did:hcs:0.0.1234:5",
  accountId: "0.0.1234",
  privateKey: "302e0201000a",
  tier: "gold",
  capabilities: ["medical-analysis"],
};

function makeDeps(): AgentDependencies {
  const sampleDataset = generatePimaSample();
  const csvData = sampleDataset.columns.join(",") + "\n" + sampleDataset.rows.map((r) => r.join(",")).join("\n");

  return {
    claimTask: vi.fn(() => Promise.resolve(true)),
    downloadDataset: vi.fn(() => Promise.resolve(csvData)),
    parseCsv: vi.fn((_csv: string) => Promise.resolve(sampleDataset)),
    analyze: vi.fn((_ds: TypedDataset) => {
      const report = runAnalysisPipeline(sampleDataset, "Pima Indians Diabetes", "pima");
      return Promise.resolve(report);
    }),
    generateReport: vi.fn((_report: AnalysisReport) => {
      const bundle: ReportBundle = {
        html: "<html><body>report</body></html>",
        json: { taskId: "test", summary: "ok" },
        metadata: { agentDid: CONFIG.did, agentTier: CONFIG.tier, taskId: "test", timestamp: new Date().toISOString() },
      };
      return Promise.resolve(bundle);
    }),
    uploadToIPFS: vi.fn(() => Promise.resolve("ipfs://QmTest123")),
    deliverResult: vi.fn(() => Promise.resolve(true)),
    verifyResult: vi.fn(() => Promise.resolve({ passed: true, checks: [], failedChecks: [] })),
    completeTask: vi.fn(() => Promise.resolve(true)),
    correctAnalysis: vi.fn((failedChecks: string[], report: AnalysisReport) => report),
  };
}

// ─── Happy path ────────────────────────────────────────────────────

describe("MedicalAgent", () => {
  it("runs full lifecycle successfully: claim → download → analyze → generate → upload → deliver → verify → complete", async () => {
    const deps = makeDeps();
    const agent = new MedicalAgent(CONFIG, deps);

    const result = await agent.run("task-happy");

    expect(result.completed).toBe(true);
    expect(result.attempts).toBe(1);
    expect(deps.claimTask).toHaveBeenCalledWith("task-happy");
    expect(deps.downloadDataset).toHaveBeenCalledTimes(1);
    expect(deps.analyze).toHaveBeenCalledTimes(1);
    expect(deps.generateReport).toHaveBeenCalledTimes(1);
    expect(deps.uploadToIPFS).toHaveBeenCalledTimes(1);
    expect(deps.deliverResult).toHaveBeenCalledWith("task-happy", "ipfs://QmTest123");
    expect(deps.verifyResult).toHaveBeenCalledTimes(1);
    expect(deps.completeTask).toHaveBeenCalledWith("task-happy");
  });

  it("logs state transitions", async () => {
    const deps = makeDeps();
    const agent = new MedicalAgent(CONFIG, deps);

    const result = await agent.run("task-logs");

    expect(result.logs.length).toBeGreaterThanOrEqual(8);
    const states = result.logs.map((l: AgentLogEntry) => l.state);
    expect(states).toContain("CLAIMING");
    expect(states).toContain("DOWNLOADING");
    expect(states).toContain("ANALYZING");
    expect(states).toContain("GENERATING");
    expect(states).toContain("UPLOADING");
    expect(states).toContain("DELIVERING");
    expect(states).toContain("VERIFYING");
    expect(states).toContain("COMPLETED");
  });

  // ─── Retry path ──────────────────────────────────────────────────

  it("retries on verification failure (pass on 3rd attempt)", async () => {
    const deps = makeDeps();
    let verifyCount = 0;
    deps.verifyResult = vi.fn(() => {
      verifyCount++;
      if (verifyCount < 3) {
        return Promise.resolve({
          passed: false,
          checks: [{ description: "glossary", passed: false, message: "no glossary terms" }],
          failedChecks: ["no glossary terms referenced"],
        });
      }
      return Promise.resolve({ passed: true, checks: [], failedChecks: [] });
    });

    const agent = new MedicalAgent(CONFIG, deps);
    const result = await agent.run("task-retry");

    expect(result.completed).toBe(true);
    expect(result.attempts).toBe(3);
    expect(deps.verifyResult).toHaveBeenCalledTimes(3);
    expect(deps.completeTask).toHaveBeenCalledTimes(1);
  });

  // ─── Abort paths ─────────────────────────────────────────────────

  it("aborts after 3 verification failures", async () => {
    const deps = makeDeps();
    deps.verifyResult = vi.fn(() =>
      Promise.resolve({
        passed: false,
        checks: [{ description: "always", passed: false, message: "fails" }],
        failedChecks: ["persistent failure"],
      }),
    );

    const agent = new MedicalAgent(CONFIG, deps);
    const result = await agent.run("task-abort-verify");

    expect(result.completed).toBe(false);
    expect(result.attempts).toBe(3);
    expect(deps.completeTask).not.toHaveBeenCalled();
  });

  it("aborts on HFS download failure", async () => {
    const deps = makeDeps();
    deps.downloadDataset = vi.fn(() => Promise.reject(new Error("HFS timeout")));

    const agent = new MedicalAgent(CONFIG, deps);
    const result = await agent.run("task-download-fail");

    expect(result.completed).toBe(false);
    expect(result.error).toContain("HFS timeout");
    expect(deps.analyze).not.toHaveBeenCalled();
  });

  it("aborts on claim failure (already claimed)", async () => {
    const deps = makeDeps();
    deps.claimTask = vi.fn(() => Promise.reject(new Error("Task already claimed")));

    const agent = new MedicalAgent(CONFIG, deps);
    const result = await agent.run("task-claim-fail");

    expect(result.completed).toBe(false);
    expect(result.error).toContain("already claimed");
    expect(deps.downloadDataset).not.toHaveBeenCalled();
  });

  it("aborts on analysis failure", async () => {
    const deps = makeDeps();
    deps.analyze = vi.fn(() => Promise.reject(new Error("analysis error")));

    const agent = new MedicalAgent(CONFIG, deps);
    const result = await agent.run("task-analysis-fail");

    expect(result.completed).toBe(false);
    expect(result.error).toContain("analysis error");
    expect(deps.generateReport).not.toHaveBeenCalled();
  });

  // ─── State machine ───────────────────────────────────────────────

  it("starts in IDLE state", () => {
    const deps = makeDeps();
    const agent = new MedicalAgent(CONFIG, deps);
    expect(agent.getState()).toBe("IDLE");
  });

  it("returns to IDLE after completion", async () => {
    const deps = makeDeps();
    const agent = new MedicalAgent(CONFIG, deps);
    await agent.run("task-idle");
    expect(agent.getState()).toBe("IDLE");
  });

  it("returns to IDLE after abort", async () => {
    const deps = makeDeps();
    deps.claimTask = vi.fn(() => Promise.reject(new Error("fail")));
    const agent = new MedicalAgent(CONFIG, deps);
    await agent.run("task-abort-idle");
    expect(agent.getState()).toBe("IDLE");
  });
});
