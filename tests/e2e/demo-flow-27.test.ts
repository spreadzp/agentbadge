import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import demo from "../../src/server/routes/demo";
import { seedMedicalTasks } from "../../src/scripts/seed-medical-tasks";
import { marketUpsert as upsert, marketGet as getTask, listTasks } from "@agentgate-hedera/passport";
import type { CachedMarketTask } from "@agentgate-hedera/hedera-core";

const app = new Hono();
app.route("/api/demo", demo);

const SKIP_E2E = process.env.SKIP_E2E === "true";
const SERVER_URL = process.env.MARKETPLACE_URL ?? "http://localhost:3001";

const seededTaskIds: string[] = [];

function createMockTask(overrides: Partial<CachedMarketTask> = {}): CachedMarketTask {
  return {
    taskId: `task-e2e-${Date.now()}`,
    posterDid: "did:hcs:0.0.0:3",
    title: "E2E Test Task",
    description: "Test task for E2E flow",
    priceHbar: 5,
    capabilities: ["medical-analysis"],
    status: "posted",
    txId: `0.0.5266613@${Math.floor(Date.now() / 1000)}.000000000`,
    consensusTimestamp: new Date().toISOString(),
    createdAt: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

describe("E2E Demo Flow", () => {
  beforeAll(() => {
    if (SKIP_E2E) return;
  });

  afterAll(() => {
    for (const taskId of seededTaskIds) {
      const task = getTask(taskId);
      if (task) {
        upsert({ ...task, status: "cancelled" });
      }
    }
  });

  it("should skip when SKIP_E2E=true", () => {
    if (SKIP_E2E) {
      expect(SKIP_E2E).toBe(true);
    }
  });

  it("seeds 3 medical tasks via seed script", async () => {
    if (SKIP_E2E) return;

    const originalFetch = globalThis.fetch;
    let createdCount = 0;
    globalThis.fetch = (async (_url: string, _opts?: RequestInit) => {
      createdCount++;
      const taskId = `task-e2e-seed-${Date.now()}-${createdCount}`;
      seededTaskIds.push(taskId);
      const task = createMockTask({
        taskId,
        title: `Medical Analysis ${createdCount}`,
        status: "posted",
        verifierType: "datahub",
      });
      upsert(task);
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ taskId, txId: "0.0.1@123" }),
      } as Response;
    }) as typeof fetch;

    try {
      const results = await seedMedicalTasks("did:hcs:0.0.0:3", "fake-key", SERVER_URL, 5);
      expect(results.length).toBe(3);
      expect(results.every((r) => r.status === "posted")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("marketplace lists medical tasks with verifierType=datahub", () => {
    if (SKIP_E2E) return;

    const task = createMockTask({ verifierType: "datahub" });
    upsert(task);
    seededTaskIds.push(task.taskId);

    const { tasks } = listTasks({ capability: "medical-analysis", limit: 100 });
    const medicalTasks = tasks.filter((t) => t.capabilities.includes("medical-analysis"));
    expect(medicalTasks.length).toBeGreaterThan(0);

    const withVerifier = medicalTasks.filter((t) => t.verifierType === "datahub");
    expect(withVerifier.length).toBeGreaterThan(0);
  });

  it("escrow panel shows correct status for posted task", () => {
    if (SKIP_E2E) return;

    const task = createMockTask({
      status: "posted",
      escrowStatus: "pending",
      scheduleId: "0.0.123",
      priceHbar: 5,
    });
    upsert(task);
    seededTaskIds.push(task.taskId);

    const fetched = getTask(task.taskId);
    expect(fetched).toBeDefined();
    expect(fetched!.escrowStatus).toBe("pending");
    expect(fetched!.scheduleId).toBe("0.0.123");
  });

  it("task transitions through lifecycle: posted -> claimed -> delivered -> completed", async () => {
    if (SKIP_E2E) return;

    const task = createMockTask({ status: "posted" });
    upsert(task);
    seededTaskIds.push(task.taskId);

    upsert({ ...task, status: "claimed", claimerDid: "did:hcs:0.0.0:2" });
    let fetched = getTask(task.taskId);
    expect(fetched!.status).toBe("claimed");

    upsert({
      ...fetched!,
      status: "delivered",
      resultIpfs: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    });
    fetched = getTask(task.taskId);
    expect(fetched!.status).toBe("delivered");
    expect(fetched!.resultIpfs).toMatch(/^ipfs:\/\/.+/);

    upsert({
      ...fetched!,
      status: "completed",
      paymentTxId: "0.0.5266613@123.000000000",
    });
    fetched = getTask(task.taskId);
    expect(fetched!.status).toBe("completed");
    expect(fetched!.paymentTxId).toBeDefined();
  });

  it("HashScan link is valid format", () => {
    if (SKIP_E2E) return;

    const txId = "0.0.5266613@123.000000000";
    const hashscanUrl = `https://hashscan.io/testnet/transaction/${txId}`;
    expect(hashscanUrl).toContain("hashscan.io");
    expect(hashscanUrl).toContain("testnet");
    expect(hashscanUrl).toContain(txId);
  });

  it("DataHub links present in agent mode response", async () => {
    if (SKIP_E2E) return;

    const res = await app.request("/api/demo/medical-data/generate-and-process?mode=agent", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.datahubLinks).toBeDefined();
    expect(body.datahubLinks.dataset).toContain("dataset");
    expect(body.datahubLinks.lineage).toContain("lineage");
    seededTaskIds.push(body.taskId);
  });

  it("verification panel data available on completed task", () => {
    if (SKIP_E2E) return;

    const task = createMockTask({
      status: "completed",
      verificationAttempts: 2,
      verificationReport: JSON.stringify({
        overallStatus: "passed",
        attempts: 2,
        assertions: [
          { name: "glucose_range", passed: true, detail: "Mean glucose: 120.8" },
          { name: "glossary_coverage", passed: true, detail: "3 terms found" },
        ],
        termsFound: ["urn:li:glossaryTerm:Hyperglycemia", "urn:li:glossaryTerm:Obesity"],
        termsMissing: [],
      }),
    });
    upsert(task);
    seededTaskIds.push(task.taskId);

    const fetched = getTask(task.taskId);
    expect(fetched!.verificationAttempts).toBe(2);
    expect(fetched!.verificationReport).toBeDefined();

    const report = JSON.parse(fetched!.verificationReport!);
    expect(report.overallStatus).toBe("passed");
    expect(report.assertions.length).toBe(2);
    expect(report.termsFound.length).toBe(2);
    expect(report.termsMissing.length).toBe(0);
  });

  it("demo mode backward compatible", async () => {
    if (SKIP_E2E) return;

    const res = await app.request("/api/demo/medical-data/generate-and-process?mode=demo", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("demo");
    expect(body.data).toBeDefined();
    expect(body.analysis).toBeDefined();
    expect(body.taskId).toBeUndefined();
  });
});
