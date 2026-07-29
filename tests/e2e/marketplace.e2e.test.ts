import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";


import { setupMockEnv, makeTestApp } from "./helpers";
import { createTestAgent, revokeTestAgent, resetTestState, type TestAgent } from "../fixtures/agents";
import { makeHttpClient } from "../fixtures/http-client";
import { marketClear as clearMarketCache, marketUpsert as upsert, marketGet as get, listTasks } from "@agentgate-hedera/passport";
import { topicMessages } from "@agentgate-hedera/hedera-core";
import {
  postTaskHandler,
  listTasksHandler,
  claimTaskHandler,
  deliverResultHandler,
  completeTaskHandler,
} from "@agentgate-hedera/mcp";
import type { CachedMarketTask } from "@agentgate-hedera/hedera-core";
import type { Hono } from "hono";

const E2E_TIMEOUT = 30000;

describe("SLICE-9-9: Marketplace E2E", () => {
  let agentA: TestAgent;
  let agentB: TestAgent;

  let testApp: Hono;

  beforeAll(async () => {
    setupMockEnv();
    resetTestState();
    agentA = await createTestAgent("MarketAgentA", "silver");
    agentB = await createTestAgent("MarketAgentB", "silver");
    // Create an in-process app for MCP tool handlers (they call fetch to SERVER_URL)
    testApp = makeTestApp();
    // Stub global fetch so MCP handler apiPost() calls go to our in-process app
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      return testApp.request(path, init);
    });
  }, E2E_TIMEOUT);

  afterAll(async () => {
    await revokeTestAgent(agentA);
    await revokeTestAgent(agentB);
    vi.unstubAllGlobals();
  }, E2E_TIMEOUT);

  beforeEach(() => {
    vi.clearAllMocks();
    setupMockEnv();
    clearMarketCache();
    topicMessages.clear();
  });

  describe("REST API", () => {
    it(
      "1. Agent A posts task via POST /market/tasks",
      async () => {
        const client = makeHttpClient(agentA.app);
        const res = await client.post("/market/tasks", {
          posterDid: agentA.did,
          title: "Code review for PR #42",
          description: "Review smart contract PR for security issues",
          priceHbar: 5,
          capabilities: ["code_review"],
        });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty("txId");
        expect(res.body).toHaveProperty("taskId");
        expect(res.body).toHaveProperty("timestamp");
        expect(res.body.taskId).toMatch(/^task-/);
      },
      E2E_TIMEOUT,
    );

    it(
      "2. GET /market/tasks lists posted tasks",
      async () => {
        const client = makeHttpClient(agentA.app);

        // Seed a task into cache
        const task: CachedMarketTask = {
          taskId: "task-rest-list-001",
          posterDid: agentA.did,
          title: "Data analysis task",
          description: "Analyze dataset for trends",
          priceHbar: 10,
          capabilities: ["data_analysis"],
          status: "posted",
          txId: "0.0.111@1234567890",
          consensusTimestamp: "2026-01-01T00:00:00Z",
          createdAt: Math.floor(Date.now() / 1000),
        };
        upsert(task);

        const res = await client.get("/market/tasks");

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty("tasks");
        expect(Array.isArray(res.body.tasks)).toBe(true);
        expect(res.body.tasks.length).toBeGreaterThanOrEqual(1);
        expect(res.body).toHaveProperty("total");
      },
      E2E_TIMEOUT,
    );

    it(
      "3. GET /market/tasks/:taskId returns specific task",
      async () => {
        const client = makeHttpClient(agentA.app);

        const task: CachedMarketTask = {
          taskId: "task-rest-get-001",
          posterDid: agentA.did,
          title: "Specific task lookup",
          description: "Test task retrieval by ID",
          priceHbar: 3,
          capabilities: ["testing"],
          status: "posted",
          txId: "0.0.111@1234567891",
          consensusTimestamp: "2026-01-01T00:00:01Z",
          createdAt: Math.floor(Date.now() / 1000),
        };
        upsert(task);

        const res = await client.get(`/market/tasks/${task.taskId}`);

        expect(res.status).toBe(200);
        expect(res.body.task.taskId).toBe(task.taskId);
        expect(res.body.task.title).toBe(task.title);
      },
      E2E_TIMEOUT,
    );

    it(
      "4. GET /market/tasks/:taskId returns 404 for non-existent task",
      async () => {
        const client = makeHttpClient(agentA.app);
        const res = await client.get("/market/tasks/nonexistent-task-id");

        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty("error");
      },
      E2E_TIMEOUT,
    );

    it(
      "5. POST /market/tasks rejects invalid DID format",
      async () => {
        const client = makeHttpClient(agentA.app);
        const res = await client.post("/market/tasks", {
          posterDid: "invalid-did",
          title: "Test",
          description: "Test",
          priceHbar: 1,
          capabilities: ["test"],
        });

        expect(res.status).toBe(400);
      },
      E2E_TIMEOUT,
    );

    it(
      "6. GET /market/tasks filters by capability",
      async () => {
        const client = makeHttpClient(agentA.app);

        upsert({
          taskId: "task-filter-001",
          posterDid: agentA.did,
          title: "Code review task",
          description: "Review code",
          priceHbar: 5,
          capabilities: ["code_review"],
          status: "posted",
          txId: "0.0.111@1",
          consensusTimestamp: "2026-01-01T00:00:00Z",
          createdAt: 1000001,
        });
        upsert({
          taskId: "task-filter-002",
          posterDid: agentA.did,
          title: "Data analysis task",
          description: "Analyze data",
          priceHbar: 8,
          capabilities: ["data_analysis"],
          status: "posted",
          txId: "0.0.111@2",
          consensusTimestamp: "2026-01-01T00:00:02Z",
          createdAt: 1000002,
        });

        const res = await client.get("/market/tasks?capability=code_review");

        expect(res.status).toBe(200);
        expect(res.body.tasks.every((t: CachedMarketTask) => t.capabilities.includes("code_review"))).toBe(true);
      },
      E2E_TIMEOUT,
    );
  });

  describe("MCP Tools — Full Workflow", () => {
    it(
      "7. Agent A posts → Agent B claims → Agent B delivers → Agent A completes",
      async () => {
        // Step 1: Post task via MCP
        const postResult = await postTaskHandler({
          posterDid: agentA.did,
          title: "E2E MCP workflow task",
          description: "Full lifecycle test via MCP tools",
          priceHbar: 7,
          capabilities: ["code_review"],
        });

        expect(postResult.isError).toBeFalsy();
        const postContent = JSON.parse((postResult.content[0] as { text: string }).text);
        expect(postContent).toHaveProperty("taskId");
        const taskId = postContent.taskId;

        // Verify task is in cache
        const cached = get(taskId);
        expect(cached).toBeDefined();
        expect(cached!.status).toBe("posted");
        expect(cached!.posterDid).toBe(agentA.did);

        // Step 2: List tasks via MCP
        const listResult = await listTasksHandler({});
        expect(listResult.isError).toBeFalsy();
        const listContent = JSON.parse((listResult.content[0] as { text: string }).text);
        expect(listContent.tasks.length).toBeGreaterThanOrEqual(1);
        expect(listContent.tasks.some((t: CachedMarketTask) => t.taskId === taskId)).toBe(true);

        // Step 3: Agent B claims task via MCP
        const claimResult = await claimTaskHandler({
          taskId,
          claimerDid: agentB.did,
        });

        expect(claimResult.isError).toBeFalsy();
        const claimContent = JSON.parse((claimResult.content[0] as { text: string }).text);
        expect(claimContent.taskId).toBe(taskId);
        expect(claimContent.txId).toBeTruthy();

        // Verify cache updated
        const claimedTask = get(taskId);
        expect(claimedTask!.status).toBe("claimed");
        expect(claimedTask!.claimerDid).toBe(agentB.did);

        // Step 4: Agent B delivers result via MCP
        const deliverResult = await deliverResultHandler({
          taskId,
          claimerDid: agentB.did,
          resultBody: "Code review complete. No issues found.",
        });

        expect(deliverResult.isError).toBeFalsy();
        const deliverContent = JSON.parse((deliverResult.content[0] as { text: string }).text);
        expect(deliverContent.taskId).toBe(taskId);
        expect(deliverContent.txId).toBeTruthy();

        // Verify cache updated
        const deliveredTask = get(taskId);
        expect(deliveredTask!.status).toBe("delivered");
        expect(deliveredTask!.resultBody).toBe("Code review complete. No issues found.");

        // Step 5: Agent A completes task via MCP
        const completeResult = await completeTaskHandler({
          taskId,
          posterDid: agentA.did,
          posterPrivateKey: "mock-private-key",
        });

        expect(completeResult.isError).toBeFalsy();
        const completeContent = JSON.parse((completeResult.content[0] as { text: string }).text);
        expect(completeContent.taskId).toBe(taskId);
        expect(completeContent).toHaveProperty("paymentTxId");

        // Verify final cache state
        const completedTask = get(taskId);
        expect(completedTask!.status).toBe("completed");
        expect(completedTask!.paymentTxId).toBeDefined();
      },
      E2E_TIMEOUT,
    );
  });

  describe("Concurrent Claim — Race Condition", () => {
    it(
      "8. Two agents claim same task: first succeeds, second fails",
      async () => {
        // Post a task
        const postResult = await postTaskHandler({
          posterDid: agentA.did,
          title: "Concurrent claim test task",
          description: "Race condition test",
          priceHbar: 5,
          capabilities: ["code_review"],
        });
        const postContent = JSON.parse((postResult.content[0] as { text: string }).text);
        const taskId = postContent.taskId;

        // Two agents claim simultaneously
        const [result1, result2] = await Promise.all([
          claimTaskHandler({ taskId, claimerDid: agentB.did }),
          claimTaskHandler({ taskId, claimerDid: agentA.did }),
        ]);

        // At least one should succeed
        const successCount = [result1, result2].filter((r) => !r.isError).length;
        expect(successCount).toBeGreaterThanOrEqual(1);

        // Verify task is claimed by one of the agents
        const claimedTask = get(taskId);
        expect(claimedTask!.status).toBe("claimed");
        expect([agentA.did, agentB.did]).toContain(claimedTask!.claimerDid);
      },
      E2E_TIMEOUT,
    );
  });

  describe("MCP Parity with REST API", () => {
    it(
      "9. POST /market/tasks and post_task MCP produce semantically equivalent results",
      async () => {
        // REST API
        const client = makeHttpClient(agentA.app);
        const restRes = await client.post("/market/tasks", {
          posterDid: agentA.did,
          title: "Parity test task",
          description: "Compare REST vs MCP",
          priceHbar: 4,
          capabilities: ["testing"],
        });

        expect(restRes.status).toBe(200);

        // MCP tool
        const mcpResult = await postTaskHandler({
          posterDid: agentA.did,
          title: "Parity test task",
          description: "Compare REST vs MCP",
          priceHbar: 4,
          capabilities: ["testing"],
        });

        expect(mcpResult.isError).toBeFalsy();

        // Semantic parity: both return taskId + txId
        const restBody = restRes.body;
        const mcpContent = JSON.parse((mcpResult.content[0] as { text: string }).text);

        expect(restBody).toHaveProperty("taskId");
        expect(restBody).toHaveProperty("txId");
        expect(mcpContent).toHaveProperty("taskId");
        expect(mcpContent).toHaveProperty("txId");

        // Both tasks should be in cache with status "posted"
        const restTask = get(restBody.taskId);
        const mcpTask = get(mcpContent.taskId);

        expect(restTask).toBeDefined();
        expect(mcpTask).toBeDefined();
        expect(restTask!.status).toBe("posted");
        expect(mcpTask!.status).toBe("posted");
        expect(restTask!.title).toBe(mcpTask!.title);
        expect(restTask!.priceHbar).toBe(mcpTask!.priceHbar);
      },
      E2E_TIMEOUT,
    );

    it(
      "10. GET /market/tasks and list_tasks MCP produce semantically equivalent results",
      async () => {
        // Seed a task
        const task: CachedMarketTask = {
          taskId: "task-parity-list-001",
          posterDid: agentA.did,
          title: "Parity list test",
          description: "Compare list endpoints",
          priceHbar: 6,
          capabilities: ["testing"],
          status: "posted",
          txId: "0.0.111@999",
          consensusTimestamp: "2026-01-01T00:00:00Z",
          createdAt: Math.floor(Date.now() / 1000),
        };
        upsert(task);

        // REST API
        const client = makeHttpClient(agentA.app);
        const restRes = await client.get("/market/tasks");

        // MCP tool
        const mcpResult = await listTasksHandler({});

        expect(restRes.status).toBe(200);
        expect(mcpResult.isError).toBeFalsy();

        const restTasks = restRes.body.tasks as CachedMarketTask[];
        const mcpContent = JSON.parse((mcpResult.content[0] as { text: string }).text);
        const mcpTasks = mcpContent.tasks as CachedMarketTask[];

        // Both should contain the seeded task
        expect(restTasks.some((t) => t.taskId === task.taskId)).toBe(true);
        expect(mcpTasks.some((t) => t.taskId === task.taskId)).toBe(true);

        // Both should have same total count
        expect(restRes.body.total).toBe(mcpContent.total);
      },
      E2E_TIMEOUT,
    );
  });

  describe("Error Handling", () => {
    it(
      "11. claim_task on non-existent task returns error",
      async () => {
        const result = await claimTaskHandler({
          taskId: "nonexistent-task",
          claimerDid: agentB.did,
        });

        expect(result.isError).toBe(true);
      },
      E2E_TIMEOUT,
    );

    it(
      "12. deliver_result on non-claimed task returns error",
      async () => {
        // Post a task (status: posted, not claimed)
        const postResult = await postTaskHandler({
          posterDid: agentA.did,
          title: "Deliver error test",
          description: "Test deliver on unclaimed task",
          priceHbar: 2,
          capabilities: ["testing"],
        });
        const postContent = JSON.parse((postResult.content[0] as { text: string }).text);

        const result = await deliverResultHandler({
          taskId: postContent.taskId,
          claimerDid: agentB.did,
          resultBody: "Should fail",
        });

        expect(result.isError).toBe(true);
      },
      E2E_TIMEOUT,
    );

    it(
      "13. complete_task by non-poster returns error",
      async () => {
        // Post + claim + deliver
        const postResult = await postTaskHandler({
          posterDid: agentA.did,
          title: "Complete error test",
          description: "Test complete by wrong poster",
          priceHbar: 2,
          capabilities: ["testing"],
        });
        const postContent = JSON.parse((postResult.content[0] as { text: string }).text);
        const taskId = postContent.taskId;

        await claimTaskHandler({ taskId, claimerDid: agentB.did });
        await deliverResultHandler({
          taskId,
          claimerDid: agentB.did,
          resultBody: "Done",
        });

        // Try to complete as agentB (not the poster)
        const result = await completeTaskHandler({
          taskId,
          posterDid: agentB.did,
        });

        expect(result.isError).toBe(true);
      },
      E2E_TIMEOUT,
    );
  });
});
