import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@agentgate-hedera/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  getNftInfo: vi.fn(),
  getTopicMessages: vi.fn(),
  submitAuditMessage: vi.fn(),
  submitDirectoryMessage: vi.fn(),
}));

import { upsert, clear, type DirectoryEntry } from "@agentgate-hedera/passport";
import { marketUpsert, marketClear, listTasks } from "@agentgate-hedera/passport";
import { searchRoutes } from "../src/server/routes/search";

function makeEntry(did: string, overrides: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return {
    did,
    tokenId: "0.0.1234567",
    serial: 1,
    accountId: "0.0.7654321",
    name: "TestBot",
    capabilities: ["api_call", "data_provide"],
    endpoint: "https://agent.test",
    tier: "bronze",
    timestamp: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

function makeTask(taskId: string, overrides: Record<string, unknown> = {}) {
  return {
    taskId,
    posterDid: "did:hcs:0.0.123:1",
    title: "Data Analysis Task",
    description: "Analyze medical data records",
    priceHbar: 5,
    capabilities: ["data_analysis"],
    status: "posted" as const,
    txId: "0.0.999@1.000",
    consensusTimestamp: new Date().toISOString(),
    createdAt: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

describe("GET /api/search", () => {
  beforeEach(() => {
    clear();
    marketClear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clear();
    marketClear();
  });

  it("returns 400 when q is empty", async () => {
    const res = await searchRoutes.fetch(new Request("http://localhost/api/search?q="));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 when q is missing", async () => {
    const res = await searchRoutes.fetch(new Request("http://localhost/api/search"));
    expect(res.status).toBe(400);
  });

  it("finds agents by name substring (case-insensitive)", async () => {
    upsert(makeEntry("did:hcs:0.0.123:1", { name: "MedicalBot" }));
    upsert(makeEntry("did:hcs:0.0.123:2", { serial: 2, name: "FinanceBot" }));

    const res = await searchRoutes.fetch(new Request("http://localhost/api/search?q=medical"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].type).toBe("agent");
    expect(body.results[0].name).toBe("MedicalBot");
    expect(body.count).toBe(1);
    expect(body.query).toBe("medical");
  });

  it("finds agents by skill", async () => {
    upsert(makeEntry("did:hcs:0.0.123:1", { name: "Bot1", skills: ["data_analysis", "reporting"] }));
    upsert(makeEntry("did:hcs:0.0.123:2", { serial: 2, name: "Bot2", skills: ["payment"] }));

    const res = await searchRoutes.fetch(new Request("http://localhost/api/search?q=reporting"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].name).toBe("Bot1");
  });

  it("finds agents by DID substring", async () => {
    upsert(makeEntry("did:hcs:0.0.999:1", { name: "Bot1" }));
    upsert(makeEntry("did:hcs:0.0.123:2", { serial: 2, name: "Bot2" }));

    const res = await searchRoutes.fetch(new Request("http://localhost/api/search?q=0.0.999"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].did).toContain("0.0.999");
  });

  it("finds tasks by title substring", async () => {
    marketUpsert(makeTask("task-1", { title: "Medical Data Analysis", description: "Process records" }));
    marketUpsert(makeTask("task-2", { title: "Unrelated Task", description: "Something else" }));

    const res = await searchRoutes.fetch(new Request("http://localhost/api/search?q=medical"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const tasks = body.results.filter((r: { type: string }) => r.type === "task");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Medical Data Analysis");
  });

  it("finds tasks by description substring", async () => {
    marketUpsert(makeTask("task-1", { title: "Task A", description: "Process medical records" }));
    marketUpsert(makeTask("task-2", { title: "Task B", description: "Something else" }));

    const res = await searchRoutes.fetch(new Request("http://localhost/api/search?q=medical"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const tasks = body.results.filter((r: { type: string }) => r.type === "task");
    expect(tasks).toHaveLength(1);
  });

  it("returns both agents and tasks when no type filter", async () => {
    upsert(makeEntry("did:hcs:0.0.123:1", { name: "MedicalAgent" }));
    marketUpsert(makeTask("task-1", { title: "Medical Task" }));

    const res = await searchRoutes.fetch(new Request("http://localhost/api/search?q=medical"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.length).toBeGreaterThanOrEqual(2);
    const types = body.results.map((r: { type: string }) => r.type);
    expect(types).toContain("agent");
    expect(types).toContain("task");
  });

  it("filters to agents only with type=agent", async () => {
    upsert(makeEntry("did:hcs:0.0.123:1", { name: "MedicalAgent" }));
    marketUpsert(makeTask("task-1", { title: "Medical Task" }));

    const res = await searchRoutes.fetch(new Request("http://localhost/api/search?q=medical&type=agent"));
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const result of body.results) {
      expect(result.type).toBe("agent");
    }
  });

  it("filters to tasks only with type=task", async () => {
    upsert(makeEntry("did:hcs:0.0.123:1", { name: "MedicalAgent" }));
    marketUpsert(makeTask("task-1", { title: "Medical Task" }));

    const res = await searchRoutes.fetch(new Request("http://localhost/api/search?q=medical&type=task"));
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const result of body.results) {
      expect(result.type).toBe("task");
    }
  });

  it("returns empty results with 200 when no matches", async () => {
    upsert(makeEntry("did:hcs:0.0.123:1", { name: "Bot" }));

    const res = await searchRoutes.fetch(new Request("http://localhost/api/search?q=nonexistent"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([]);
    expect(body.count).toBe(0);
  });

  it("does not call Mirror Node (in-memory only)", async () => {
    const { getNftInfo } = await import("@agentgate-hedera/hedera-core");
    upsert(makeEntry("did:hcs:0.0.123:1", { name: "TestBot" }));

    const res = await searchRoutes.fetch(new Request("http://localhost/api/search?q=test"));
    expect(res.status).toBe(200);
    expect(vi.mocked(getNftInfo)).not.toHaveBeenCalled();
  });
});
