import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { seedMedicalTasks, type SeedResult } from "../../src/scripts/seed-medical-tasks";

// Mock fetch
const originalFetch = globalThis.fetch;

function createMockFetch(responses: { ok: boolean; json: () => Promise<unknown>; status?: number; text?: () => Promise<string> }[]) {
  let callIndex = 0;
  return mock(async (_url: string, _opts?: RequestInit) => {
    const res = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return {
      ok: res.ok,
      status: res.status ?? (res.ok ? 200 : 500),
      json: res.json,
      text: res.text ?? (() => Promise.resolve("")),
    } as Response;
  });
}

describe("seed-medical-tasks", () => {
  beforeEach(() => {
    globalThis.fetch = createMockFetch([
      { ok: true, json: () => Promise.resolve({ taskId: "task-medical-001", txId: "0.0.1@123" }) },
      { ok: true, json: () => Promise.resolve({ taskId: "task-medical-002", txId: "0.0.2@123" }) },
      { ok: true, json: () => Promise.resolve({ taskId: "task-medical-003", txId: "0.0.3@123" }) },
    ]) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("creates 3 tasks", async () => {
    const results = await seedMedicalTasks("did:hcs:0.0.1001:1", "fake-key", "http://localhost:3001", 5);
    expect(results.length).toBe(3);
  });

  it("each task has status posted", async () => {
    const results = await seedMedicalTasks("did:hcs:0.0.1001:1", "fake-key", "http://localhost:3001", 5);
    for (const r of results) {
      expect(r.status).toBe("posted");
    }
  });

  it("each task has a taskId", async () => {
    const results = await seedMedicalTasks("did:hcs:0.0.1001:1", "fake-key", "http://localhost:3001", 5);
    for (const r of results) {
      expect(r.taskId).toBeDefined();
      expect(r.taskId).toContain("task-medical-");
    }
  });

  it("each task has correct title", async () => {
    const results = await seedMedicalTasks("did:hcs:0.0.1001:1", "fake-key", "http://localhost:3001", 5);
    expect(results[0].title).toContain("Pima");
    expect(results[1].title).toContain("Heart Disease");
    expect(results[2].title).toContain("Breast Cancer");
  });

  it("each task has correct price", async () => {
    const results = await seedMedicalTasks("did:hcs:0.0.1001:1", "fake-key", "http://localhost:3001", 10);
    for (const r of results) {
      expect(r.priceHbar).toBe(10);
    }
  });

  it("throws on API failure", async () => {
    globalThis.fetch = createMockFetch([
      { ok: false, status: 500, json: () => Promise.resolve({}), text: () => Promise.resolve("Server error") },
    ]) as unknown as typeof fetch;

    expect(async () => {
      await seedMedicalTasks("did:hcs:0.0.1001:1", "fake-key", "http://localhost:3001", 5);
    }).toThrow();
  });

  it("returns SeedResult type with all fields", async () => {
    const results = await seedMedicalTasks("did:hcs:0.0.1001:1", "fake-key", "http://localhost:3001", 5);
    const r: SeedResult = results[0];
    expect(r.taskId).toBeDefined();
    expect(r.title).toBeDefined();
    expect(r.priceHbar).toBeDefined();
    expect(r.status).toBeDefined();
  });
});
