import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { setupMockEnv, makeTestApp } from "./e2e/helpers";
import {
  registerPassportTools,
  registerAuditCatalogTools,
  registerDirectoryTools,
  registerA2ATools,
  registerMarketplaceTools,
  registerGuideTools,
  registerSigningTools,
  listTools,
} from "@agentbadge/mcp";

import { PrivateKey } from "@hashgraph/sdk";

const BASE_URL = "http://localhost:4021";

// Helper: generate ED25519 private key in DER hex
function makePrivateKey(): string {
  return PrivateKey.generateED25519().toStringDer();
}

describe("SLICE-15-2: POST /market/tasks/:taskId/complete-with-key — convenience endpoint", () => {
  beforeAll(() => {
    setupMockEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 for missing posterDid", async () => {
    const app = makeTestApp();
    const res = await app.request("/market/tasks/task-123/complete-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterPrivateKey: makePrivateKey() }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("posterDid");
  });

  it("returns 400 for missing posterPrivateKey", async () => {
    const app = makeTestApp();
    const res = await app.request("/market/tasks/task-123/complete-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterDid: "did:hcs:0.0.123:1" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("posterPrivateKey");
  });

  it("returns 404 for non-existent task", async () => {
    const app = makeTestApp();
    const res = await app.request("/market/tasks/nonexistent/complete-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: "did:hcs:0.0.123:1",
        posterPrivateKey: makePrivateKey(),
      }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid posterDid format", async () => {
    const app = makeTestApp();
    const res = await app.request("/market/tasks/task-123/complete-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: "invalid-did",
        posterPrivateKey: makePrivateKey(),
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("posterDid");
  });

  it("private key is never included in response body", async () => {
    const app = makeTestApp();
    const pk = makePrivateKey();
    const res = await app.request("/market/tasks/task-123/complete-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: "did:hcs:0.0.123:1",
        posterPrivateKey: pk,
      }),
    });
    const text = await res.text();
    expect(text).not.toContain(pk);
  });
});

describe("SLICE-15-2: complete_task_with_key MCP tool", () => {
  beforeAll(() => {
    setupMockEnv();
    registerPassportTools();
    registerAuditCatalogTools();
    registerDirectoryTools();
    registerA2ATools();
    registerMarketplaceTools();
    registerGuideTools();
    registerSigningTools();
  });

  it("listTools() includes complete_task_with_key", () => {
    const tools = listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("complete_task_with_key");
  });

  it("returns validation error for missing taskId", async () => {
    const { handleHttpToolCall } = await import("@agentbadge/mcp");
    const result = await handleHttpToolCall("complete_task_with_key", {
      posterDid: "did:hcs:0.0.123:1",
      posterPrivateKey: makePrivateKey(),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("taskId");
  });

  it("returns validation error for missing posterDid", async () => {
    const { handleHttpToolCall } = await import("@agentbadge/mcp");
    const result = await handleHttpToolCall("complete_task_with_key", {
      taskId: "task-123",
      posterPrivateKey: makePrivateKey(),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("posterDid");
  });

  it("returns validation error for missing posterPrivateKey", async () => {
    const { handleHttpToolCall } = await import("@agentbadge/mcp");
    const result = await handleHttpToolCall("complete_task_with_key", {
      taskId: "task-123",
      posterDid: "did:hcs:0.0.123:1",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("posterPrivateKey");
  });
});
