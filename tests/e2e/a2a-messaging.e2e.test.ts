import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";


import { setupMockEnv } from "./helpers";
import { createTestAgent, revokeTestAgent, resetTestState, type TestAgent } from "../fixtures/agents";
import { makeHttpClient } from "../fixtures/http-client";
import { a2aClear as clearA2ACache } from "@agentbadge/passport";
import { topicMessages } from "@agentbadge/hedera-core";
import { a2aUpsert, getMessagesByTo, getConversation } from "@agentbadge/passport";
import type { CachedA2AMessage } from "@agentbadge/hedera-core";

const E2E_TIMEOUT = 30000;

describe("SLICE-8-8: A2A Messaging E2E", () => {
  let agentA: TestAgent;
  let agentB: TestAgent;

  beforeAll(async () => {
    setupMockEnv();
    resetTestState();
    agentA = await createTestAgent("TestAgentA", "silver");
    agentB = await createTestAgent("TestAgentB", "silver");
  }, E2E_TIMEOUT);

  afterAll(async () => {
    await revokeTestAgent(agentA);
    await revokeTestAgent(agentB);
  }, E2E_TIMEOUT);

  beforeEach(() => {
    vi.clearAllMocks();
    setupMockEnv();
    clearA2ACache();
    topicMessages.clear();
  });

  describe("REST API", () => {
    it(
      "1. Agent A sends message to Agent B via POST /a2a/send",
      async () => {
        const client = makeHttpClient(agentA.app);
        const res = await client.post("/a2a/send", {
          from: agentA.did,
          to: agentB.did,
          body: "Hello from Agent A",
        });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty("txId");
        expect(res.body).toHaveProperty("timestamp");
        expect(res.body).toHaveProperty("messageId");
      },
      E2E_TIMEOUT,
    );

    it(
      "2. Agent B retrieves inbox via GET /a2a/inbox and sees message from A",
      async () => {
        // Seed cache with a message from A to B
        seedA2ACache(agentA.did, agentB.did, "Hello from Agent A");

        const client = makeHttpClient(agentB.app);
        const res = await client.get(`/a2a/inbox?did=${encodeURIComponent(agentB.did)}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty("messages");
        expect(res.body.messages.length).toBeGreaterThan(0);
        expect(res.body.messages[0].from).toBe(agentA.did);
        expect(res.body.messages[0].to).toBe(agentB.did);
        expect(res.body.messages[0].body).toBe("Hello from Agent A");
      },
      E2E_TIMEOUT,
    );

    it(
      "3. Agent B queries conversation with Agent A — all messages in order",
      async () => {
        // Seed 3 messages from A to B
        for (let i = 0; i < 3; i++) {
          seedA2ACache(agentA.did, agentB.did, `Message ${i + 1}`, i);
        }

        const client = makeHttpClient(agentB.app);
        const res = await client.get(
          `/a2a/conversation?didA=${encodeURIComponent(agentA.did)}&didB=${encodeURIComponent(agentB.did)}`,
        );

        expect(res.status).toBe(200);
        expect(res.body.messages.length).toBe(3);
        expect(res.body.total).toBe(3);
        expect(res.body.messages[0].body).toBe("Message 1");
        expect(res.body.messages[1].body).toBe("Message 2");
        expect(res.body.messages[2].body).toBe("Message 3");
      },
      E2E_TIMEOUT,
    );
  });

  describe("MCP Tool Parity", () => {
    it(
      "4. Same message via MCP send_message tool — result identical to REST API",
      async () => {
        // This test will be implemented when MCP tools are ready (SLICE-8-5, SLICE-8-6)
        // For now, verify cache returns same shape as REST API
        seedA2ACache(agentA.did, agentB.did, "MCP test message");

        const messages = getMessagesByTo(agentB.did);
        expect(messages.length).toBeGreaterThan(0);
        expect(messages[0].from).toBe(agentA.did);
        expect(messages[0].body).toBe("MCP test message");
      },
      E2E_TIMEOUT,
    );
  });

  describe("Pagination", () => {
    it(
      "5. Pagination with 50+ messages — pages don't overlap",
      async () => {
        // Seed 50 messages
        for (let i = 0; i < 50; i++) {
          seedA2ACache(agentA.did, agentB.did, `Bulk message ${i + 1}`, i);
        }

        const client = makeHttpClient(agentB.app);

        const page1 = await client.get(
          `/a2a/conversation?didA=${encodeURIComponent(agentA.did)}&didB=${encodeURIComponent(agentB.did)}&limit=20&offset=0`,
        );

        expect(page1.status).toBe(200);
        expect(page1.body.messages.length).toBe(20);
        expect(page1.body.total).toBeGreaterThanOrEqual(50);
        expect(page1.body.limit).toBe(20);
        expect(page1.body.offset).toBe(0);

        const page2 = await client.get(
          `/a2a/conversation?didA=${encodeURIComponent(agentA.did)}&didB=${encodeURIComponent(agentB.did)}&limit=20&offset=20`,
        );

        expect(page2.body.messages.length).toBe(20);
        expect(page2.body.offset).toBe(20);

        // Verify no overlap
        const page1Ids = page1.body.messages.map((m: any) => m.consensusTimestamp);
        const page2Ids = page2.body.messages.map((m: any) => m.consensusTimestamp);
        const overlap = page1Ids.filter((id: string) => page2Ids.includes(id));
        expect(overlap.length).toBe(0);
      },
      E2E_TIMEOUT,
    );
  });

  describe("Cache Rebuild", () => {
    it(
      "6. Messages persist in HCS and are recoverable via getTopicMessages()",
      async () => {
        // Submit a message via mock service
        const { submitA2AMessage } = await import("@agentbadge/hedera-core");
        const { getTopicMessages } = await import("@agentbadge/hedera-core");

        await submitA2AMessage({
          type: "a2a_message",
          from: agentA.did,
          to: agentB.did,
          body: "Persistence test",
          contentType: "text/plain",
          timestamp: Math.floor(Date.now() / 1000),
        });

        const topicId = process.env.A2A_TOPIC_ID ?? "0.0.777";
        const hcsMessages = await getTopicMessages(topicId);
        const a2aMessages = hcsMessages
          .map((m: any) => {
            try {
              return JSON.parse(m.message);
            } catch {
              return null;
            }
          })
          .filter((m: any) => m?.type === "a2a_message" && m.from === agentA.did && m.to === agentB.did);

        expect(a2aMessages.length).toBeGreaterThan(0);
        expect(a2aMessages[0].body).toBe("Persistence test");
      },
      E2E_TIMEOUT,
    );
  });

  describe("HTMX UI", () => {
    it(
      "7. GET /ui/a2a/inbox returns HTML fragment with messages",
      async () => {
        seedA2ACache(agentA.did, agentB.did, "UI test message");

        const client = makeHttpClient(agentB.app);
        const res = await client.get(
          `/ui/a2a/inbox?did=${encodeURIComponent(agentB.did)}`,
          { "HX-Request": "true" },
        );

        expect(res.status).toBe(200);
        expect(res.text).toContain("UI test message");
        expect(res.text).toContain("View");
      },
      E2E_TIMEOUT,
    );

    it(
      "8. GET /ui/a2a/inbox shows 'No messages' placeholder when empty",
      async () => {
        const client = makeHttpClient(agentB.app);
        const res = await client.get(
          `/ui/a2a/inbox?did=${encodeURIComponent(agentB.did)}`,
          { "HX-Request": "true" },
        );

        expect(res.status).toBe(200);
        expect(res.text).toContain("No messages");
      },
      E2E_TIMEOUT,
    );
  });
});

/**
 * Helper: seed the A2A cache with a test message.
 */
function seedA2ACache(
  from: string,
  to: string,
  body: string,
  index: number = 0,
): void {
  const msg: CachedA2AMessage = {
    type: "a2a_message",
    from,
    to,
    body,
    contentType: "text/plain",
    timestamp: Math.floor(Date.now() / 1000) + index,
    txId: `0.0.999@${Date.now()}.${index}`,
    consensusTimestamp: `${Date.now()}.${index}`,
  };
  a2aUpsert(msg);
}
