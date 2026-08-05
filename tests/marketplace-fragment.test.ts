import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { CachedMarketTask } from "@agentgate-hedera/hedera-core";

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
}));

vi.mock("@agentgate-hedera/passport", async (importOriginal) => ({
  ...await importOriginal(),
  uploadMetadata: vi.fn(),
  retrieveMetadata: vi.fn(),
  getMessagesByTo: vi.fn(),
  getConversation: vi.fn(),
  a2aUpsert: vi.fn(),
  a2aGetAll: vi.fn(),
  a2aClear: vi.fn(),
  marketUpsert: vi.fn(),
  marketGet: vi.fn(),
  listTasks: vi.fn(),
  marketClear: vi.fn(),
  marketRebuildFromHcs: vi.fn(),
}));

import { marketGet as get, listTasks } from "@agentgate-hedera/passport";
import { MarketplaceTaskBoardFragment, TaskDetailsFragment } from "../src/views/marketplace-fragment";
import { uiRoutes } from "../src/server/routes/ui";

const mockedGet = vi.mocked(get);
const mockedListTasks = vi.mocked(listTasks);

function makeTask(overrides: Partial<CachedMarketTask> = {}): CachedMarketTask {
  return {
    taskId: "task-001",
    posterDid: "did:hcs:0.0.123:1",
    title: "Data Analysis Task",
    description: "Analyze sensor data and produce a summary report",
    priceHbar: 50,
    capabilities: ["data_analysis", "reporting"],
    status: "posted",
    txId: "0.0.999-123-456",
    consensusTimestamp: "1700000000.000000001",
    createdAt: 1700000000,
    ...overrides,
  };
}

// ─── MarketplaceTaskBoardFragment ──────────────────────────────

describe("MarketplaceTaskBoardFragment", () => {
  it("renders empty state when no tasks", () => {
    const html = MarketplaceTaskBoardFragment([]).toString();
    expect(html).toContain("No tasks available");
  });

  it("renders task cards with title, price, capabilities, status", () => {
    const tasks = [makeTask()];
    const html = MarketplaceTaskBoardFragment(tasks).toString();
    expect(html).toContain("Data Analysis Task");
    expect(html).toContain("50 HBAR");
    expect(html).toContain("data_analysis");
    expect(html).toContain("posted");
  });

  it("shows first 4 tasks and Show more button when >4 tasks", () => {
    const tasks = Array.from({ length: 6 }, (_, i) =>
      makeTask({ taskId: `task-${i + 1}`, title: `Task ${i + 1}` }),
    );
    const html = MarketplaceTaskBoardFragment(tasks).toString();
    expect(html).toContain("Task 1");
    expect(html).toContain("Task 4");
    expect(html).toContain("Task 5");
    expect(html).toContain('class="hidden" data-paginated="true"');
    expect(html).toContain("Show more");
    expect(html).toContain("show-more-remaining");
    expect(html).toContain(">2</span>");
  });

  it("does not show Show more button when <=4 tasks", () => {
    const tasks = [makeTask()];
    const html = MarketplaceTaskBoardFragment(tasks).toString();
    expect(html).not.toContain("Show more");
  });

  it("Show more button uses onclick showMore", () => {
    const tasks = Array.from({ length: 6 }, (_, i) =>
      makeTask({ taskId: `task-${i + 1}`, title: `Task ${i + 1}` }),
    );
    const html = MarketplaceTaskBoardFragment(tasks).toString();
    expect(html).toContain("onclick=\"showMore");
    expect(html).toContain("data-paginated");
  });

  it("task card has View Details link to /ui/market/tasks/:id", () => {
    const tasks = [makeTask({ taskId: "task-42" })];
    const html = MarketplaceTaskBoardFragment(tasks).toString();
    expect(html).toContain('href="/ui/market/tasks/task-42"');
    expect(html).toContain("View Details");
  });

  it("truncates long descriptions to 100 chars", () => {
    const longDesc = "A".repeat(200);
    const tasks = [makeTask({ description: longDesc })];
    const html = MarketplaceTaskBoardFragment(tasks).toString();
    expect(html).not.toContain("A".repeat(101));
    expect(html).toContain("…");
  });
});

// ─── TaskDetailsFragment ───────────────────────────────────────

describe("TaskDetailsFragment", () => {
  it("renders all task fields", () => {
    const task = makeTask();
    const html = TaskDetailsFragment(task).toString();
    expect(html).toContain("Data Analysis Task");
    expect(html).toContain("Analyze sensor data and produce a summary report");
    expect(html).toContain("50 HBAR");
    expect(html).toContain("data_analysis");
    expect(html).toContain("posted");
  });

  it("shows Claim button with HTMX POST for posted tasks", () => {
    const task = makeTask({ status: "posted", taskId: "task-99" });
    const html = TaskDetailsFragment(task).toString();
    expect(html).toContain("hx-post");
    expect(html).toContain("/market/tasks/task-99/claim");
    expect(html).toContain("hx-swap");
    expect(html).toContain("outerHTML");
    expect(html).toContain("Claim Task");
  });

  it("does not show Claim button for claimed tasks", () => {
    const task = makeTask({ status: "claimed", claimerDid: "did:hcs:0.0.999:3" });
    const html = TaskDetailsFragment(task).toString();
    expect(html).not.toContain("Claim Task");
    expect(html).toContain("claimed");
  });

  it("shows claimer DID for claimed tasks", () => {
    const task = makeTask({ status: "claimed", claimerDid: "did:hcs:0.0.999:3" });
    const html = TaskDetailsFragment(task).toString();
    expect(html).toContain("Claimed by");
    expect(html).toContain("did:hcs:0.0.999:3");
  });

  it("shows result body for delivered tasks", () => {
    const task = makeTask({
      status: "delivered",
      claimerDid: "did:hcs:0.0.999:3",
      resultBody: "Analysis complete: all sensors nominal",
    });
    const html = TaskDetailsFragment(task).toString();
    expect(html).toContain("Delivery Result");
    expect(html).toContain("Analysis complete");
  });

  it("shows short DID with full DID in tooltip", () => {
    const task = makeTask({ posterDid: "did:hcs:0.0.1234567:42" });
    const html = TaskDetailsFragment(task).toString();
    expect(html).toContain("did:hcs:0.0.1234567:42");
  });

  it("renders Transactions section with 5 TX rows", () => {
    const task = makeTask();
    const html = TaskDetailsFragment(task).toString();
    expect(html).toContain("Post TX:");
    expect(html).toContain("Claim TX:");
    expect(html).toContain("Deliver TX:");
    expect(html).toContain("Payment TX:");
    expect(html).toContain("Completed TX:");
  });

  it("shows pending for empty txIds", () => {
    const task = makeTask({ txId: "" });
    const html = TaskDetailsFragment(task).toString();
    expect(html).toContain("pending");
  });

  it("shows HashScan links for all txIds on completed task", () => {
    const task = makeTask({
      status: "completed",
      claimerDid: "did:hcs:0.0.999:3",
      claimTxId: "0.0.888-1700000001-000000001",
      deliverTxId: "0.0.888-1700000002-000000001",
      paymentTxId: "0.0.777-1700000003-000000001",
      completedTxId: "0.0.888-1700000004-000000001",
    });
    const html = TaskDetailsFragment(task).toString();
    expect(html).toContain("hashscan.io");
    expect(html).toContain("0.0.888-1700000001");
    expect(html).toContain("0.0.888-1700000002");
    expect(html).toContain("0.0.777-1700000003");
    expect(html).toContain("0.0.888-1700000004");
  });

  it("shows pending for missing claim/deliver/payment/completed txIds on posted task", () => {
    const task = makeTask({ status: "posted", txId: "0.0.999-123-456" });
    const html = TaskDetailsFragment(task).toString();
    expect(html).toContain("Post TX:");
    expect(html).toContain("hashscan.io");
    expect(html).toContain("pending");
  });
});

// ─── GET /ui/market/tasks ──────────────────────────────────────

describe("GET /ui/market/tasks", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/", uiRoutes);
  });

  it("returns 200 HTML fragment with tasks", async () => {
    mockedListTasks.mockReturnValue({
      tasks: [makeTask()],
      total: 1,
    });

    const res = await app.request("/ui/market/tasks", {
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Data Analysis Task");
  });

  it("returns empty state when no tasks", async () => {
    mockedListTasks.mockReturnValue({ tasks: [], total: 0 });

    const res = await app.request("/ui/market/tasks", {
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No tasks available");
  });

  it("passes offset and capability to listTasks", async () => {
    mockedListTasks.mockReturnValue({ tasks: [], total: 0 });

    await app.request("/ui/market/tasks?offset=4&capability=data_analysis", {
      headers: { "HX-Request": "true" },
    });

    expect(mockedListTasks).toHaveBeenCalledWith({
      offset: 4,
      limit: 100,
      capability: "data_analysis",
    });
  });
});

// ─── GET /ui/market/tasks/:id ──────────────────────────────────

describe("GET /ui/market/tasks/:id", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/", uiRoutes);
  });

  it("returns 200 with task details", async () => {
    mockedGet.mockReturnValue(makeTask({ taskId: "task-42" }));

    const res = await app.request("/ui/market/tasks/task-42", {
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Data Analysis Task");
    expect(html).toContain("50 HBAR");
  });

  it("returns 404 for missing task", async () => {
    mockedGet.mockReturnValue(undefined);

    const res = await app.request("/ui/market/tasks/nonexistent", {
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("Task not found");
  });

  it("shows Claim button for posted task", async () => {
    mockedGet.mockReturnValue(makeTask({ status: "posted", taskId: "task-7" }));

    const res = await app.request("/ui/market/tasks/task-7", {
      headers: { "HX-Request": "true" },
    });
    const html = await res.text();
    expect(html).toContain("hx-post");
    expect(html).toContain("/market/tasks/task-7/claim");
  });
});
