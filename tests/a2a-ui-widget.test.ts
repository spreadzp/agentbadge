import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CachedA2AMessage } from "@agentgate-hedera/hedera-core";
import type { MarketTask } from "../src/server/lib/market-task.js";

vi.mock("@agentgate-hedera/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  getNftsForToken: vi.fn(),
  getNftInfo: vi.fn(),
  getNftsForAccount: vi.fn(),
  getTopicMessages: vi.fn(),
  submitAuditMessage: vi.fn(),
  submitDirectoryMessage: vi.fn(),
  mintPassportNFT: vi.fn(),
  transferNFTToAgent: vi.fn(),
  wipeNFT: vi.fn(),
  updateNftMetadata: vi.fn(),
  prepareA2ATopicMessage: vi.fn(),
  signTransactionBytes: vi.fn(),
  submitSignedTopicMessage: vi.fn(),
}));

vi.mock("@agentgate-hedera/passport", async (importOriginal) => ({
  ...await importOriginal(),
  getMessagesByTo: vi.fn(),
  getConversation: vi.fn(),
  a2aUpsert: vi.fn(),
  a2aGetAll: vi.fn(),
  a2aClear: vi.fn(),
}));

vi.mock("../src/server/lib/chain-ui.js", () => ({
  explorerTxUrl: (txId: string) => `https://explorer.test/tx/${txId}`,
  explorerName: () => "Explorer",
  accountPlaceholder: () => "0.0.xxxx",
}));

import { TaskMessagesFragment } from "../src/views/marketplace-fragment";

const VIEWER_DID = "did:hcs:0.0.123:5";
const POSTER_DID = "did:hcs:0.0.456:10";

function makeTask(overrides: Partial<MarketTask> = {}): MarketTask {
  const base: MarketTask = {
    id: "task-001",
    posterDid: POSTER_DID,
    title: "Test Task",
    description: "Test description",
    price: "5 HBAR",
    priceRaw: "500000000",
    currency: "HBAR",
    capabilities: ["data_analysis"],
    status: "posted",
    txId: "0.0.999@1700000000.000000001",
    txExplorerUrl: "https://explorer.test/tx/0.0.999@1700000000.000000001",
    posterAddress: "0.0.456",
    consensusTimestamp: "1700000000.000000001",
    createdAt: 1700000000,
  };
  return { ...base, ...overrides };
}

function makeMsg(overrides: Partial<CachedA2AMessage> = {}): CachedA2AMessage {
  return {
    type: "a2a_message",
    from: POSTER_DID,
    to: VIEWER_DID,
    body: "Hello from poster",
    contentType: "text/plain",
    timestamp: Math.floor(Date.now() / 1000) - 120,
    txId: "0.0.999@1700000000.000000001",
    consensusTimestamp: "1700000000.000000001",
    ...overrides,
  };
}

describe("TaskMessagesFragment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'No messages' placeholder when empty", () => {
    const task = makeTask();
    const fragment = TaskMessagesFragment(task, [], VIEWER_DID);
    const str = fragment.toString();
    expect(str).toContain("No messages yet");
  });

  it("separates Inbox and Outbox sections with counts", () => {
    const task = makeTask();
    const messages = [
      makeMsg({ from: POSTER_DID, to: VIEWER_DID, body: "Inbox msg" }),
      makeMsg({ from: VIEWER_DID, to: POSTER_DID, body: "Outbox msg", txId: "0.0.888@1700000001.000000001" }),
    ];
    const fragment = TaskMessagesFragment(task, messages, VIEWER_DID);
    const str = fragment.toString();
    expect(str).toContain("Inbox (1)");
    expect(str).toContain("Outbox (1)");
    expect(str).toContain("Inbox msg");
    expect(str).toContain("Outbox msg");
  });

  it("does not render Inbox section when no inbox messages", () => {
    const task = makeTask();
    const messages = [
      makeMsg({ from: VIEWER_DID, to: POSTER_DID, body: "Only outbox" }),
    ];
    const fragment = TaskMessagesFragment(task, messages, VIEWER_DID);
    const str = fragment.toString();
    expect(str).not.toContain("Inbox (");
    expect(str).toContain("Outbox (1)");
  });

  it("does not render Outbox section when no outbox messages", () => {
    const task = makeTask();
    const messages = [
      makeMsg({ from: POSTER_DID, to: VIEWER_DID, body: "Only inbox" }),
    ];
    const fragment = TaskMessagesFragment(task, messages, VIEWER_DID);
    const str = fragment.toString();
    expect(str).toContain("Inbox (1)");
    expect(str).not.toContain("Outbox (");
  });

  it("includes explorer link for message txId", () => {
    const task = makeTask();
    const txId = "0.0.999@1700000000.000000001";
    const messages = [makeMsg({ txId })];
    const fragment = TaskMessagesFragment(task, messages, VIEWER_DID);
    const str = fragment.toString();
    expect(str).toContain("explorer.test");
    expect(str).toContain(txId);
  });

  it("includes fromAccountId and privateKey fields in reply form", () => {
    const task = makeTask();
    const fragment = TaskMessagesFragment(task, [], VIEWER_DID);
    const str = fragment.toString();
    expect(str).toContain('name="fromAccountId"');
    expect(str).toContain('name="privateKey"');
    expect(str).toContain('type="password"');
  });

  it("includes hidden from and to fields with correct DIDs", () => {
    const task = makeTask();
    const fragment = TaskMessagesFragment(task, [], VIEWER_DID);
    const str = fragment.toString();
    expect(str).toContain(`name="from" value="${VIEWER_DID}"`);
    expect(str).toContain(`name="to" value="${POSTER_DID}"`);
  });

  it("shows total message count badge when messages exist", () => {
    const task = makeTask();
    const messages = [
      makeMsg({ from: POSTER_DID, to: VIEWER_DID }),
      makeMsg({ from: VIEWER_DID, to: POSTER_DID, txId: "0.0.888@1700000001" }),
    ];
    const fragment = TaskMessagesFragment(task, messages, VIEWER_DID);
    const str = fragment.toString();
    expect(str).toContain(">2<");
  });

  it("has correct HTMX attributes on form", () => {
    const task = makeTask();
    const fragment = TaskMessagesFragment(task, [], VIEWER_DID);
    const str = fragment.toString();
    expect(str).toContain(`hx-post="/ui/market/tasks/${task.id}/send-message"`);
    expect(str).toContain('hx-target="#task-messages"');
    expect(str).toContain('hx-swap="outerHTML"');
  });

  it("displays viewer DID in short format with full DID in tooltip", () => {
    const task = makeTask();
    const fragment = TaskMessagesFragment(task, [], VIEWER_DID);
    const str = fragment.toString();
    expect(str).toContain(`title="${VIEWER_DID}"`);
    expect(str).toContain(`title="${POSTER_DID}"`);
  });
});
