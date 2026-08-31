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

function makePrivateKey(): string {
  return PrivateKey.generateED25519().toStringDer();
}

const VALID_DID = "did:hcs:0.0.123:1";

describe("SLICE-15-4: POST /market/tasks/:taskId/claim-with-key — agent-signed HCS claim", () => {
  beforeAll(() => {
    setupMockEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 for missing claimerDid", async () => {
    const app = makeTestApp();
    const res = await app.request("/market/tasks/task-1/claim-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimerPrivateKey: makePrivateKey(),
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("claimerDid");
  });

  it("returns 400 for missing claimerPrivateKey", async () => {
    const app = makeTestApp();
    const res = await app.request("/market/tasks/task-1/claim-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimerDid: VALID_DID,
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("claimerPrivateKey");
  });

  it("returns 400 for invalid claimerDid format", async () => {
    const app = makeTestApp();
    const res = await app.request("/market/tasks/task-1/claim-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimerDid: "invalid-did",
        claimerPrivateKey: makePrivateKey(),
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("claimerDid");
  });

  it("private key is never included in response body", async () => {
    const app = makeTestApp();
    const pk = makePrivateKey();
    const res = await app.request("/market/tasks/task-1/claim-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimerDid: VALID_DID,
        claimerPrivateKey: pk,
      }),
    });
    const text = await res.text();
    expect(text).not.toContain(pk);
  });
});

describe("SLICE-15-4: POST /market/tasks/:taskId/deliver-with-key — agent-signed HCS delivery", () => {
  beforeAll(() => {
    setupMockEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 for missing claimerDid", async () => {
    const app = makeTestApp();
    const res = await app.request("/market/tasks/task-1/deliver-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resultBody: "test result",
        claimerPrivateKey: makePrivateKey(),
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("claimerDid");
  });

  it("returns 400 for missing claimerPrivateKey", async () => {
    const app = makeTestApp();
    const res = await app.request("/market/tasks/task-1/deliver-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimerDid: VALID_DID,
        resultBody: "test result",
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("claimerPrivateKey");
  });

  it("returns 400 for missing result (neither resultIpfs nor resultBody)", async () => {
    const app = makeTestApp();
    const res = await app.request("/market/tasks/task-1/deliver-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimerDid: VALID_DID,
        claimerPrivateKey: makePrivateKey(),
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("result");
  });

  it("returns 400 for invalid claimerDid format", async () => {
    const app = makeTestApp();
    const res = await app.request("/market/tasks/task-1/deliver-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimerDid: "invalid-did",
        resultBody: "test result",
        claimerPrivateKey: makePrivateKey(),
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("claimerDid");
  });

  it("private key is never included in response body", async () => {
    const app = makeTestApp();
    const pk = makePrivateKey();
    const res = await app.request("/market/tasks/task-1/deliver-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimerDid: VALID_DID,
        resultBody: "test result",
        claimerPrivateKey: pk,
      }),
    });
    const text = await res.text();
    expect(text).not.toContain(pk);
  });
});

describe("SLICE-15-4: claim_task_with_key MCP tool", () => {
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

  it("listTools() includes claim_task_with_key", () => {
    const tools = listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("claim_task_with_key");
  });

  it("returns validation error for missing claimerDid", async () => {
    const { handleHttpToolCall } = await import("@agentbadge/mcp");
    const result = await handleHttpToolCall("claim_task_with_key", {
      taskId: "task-1",
      claimerPrivateKey: makePrivateKey(),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("claimerDid");
  });

  it("returns validation error for missing taskId", async () => {
    const { handleHttpToolCall } = await import("@agentbadge/mcp");
    const result = await handleHttpToolCall("claim_task_with_key", {
      claimerDid: VALID_DID,
      claimerPrivateKey: makePrivateKey(),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("taskId");
  });

  it("returns validation error for missing claimerPrivateKey", async () => {
    const { handleHttpToolCall } = await import("@agentbadge/mcp");
    const result = await handleHttpToolCall("claim_task_with_key", {
      taskId: "task-1",
      claimerDid: VALID_DID,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("claimerPrivateKey");
  });
});

describe("SLICE-15-4: deliver_result_with_key MCP tool", () => {
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

  it("listTools() includes deliver_result_with_key", () => {
    const tools = listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("deliver_result_with_key");
  });

  it("returns validation error for missing claimerDid", async () => {
    const { handleHttpToolCall } = await import("@agentbadge/mcp");
    const result = await handleHttpToolCall("deliver_result_with_key", {
      taskId: "task-1",
      resultBody: "test result",
      claimerPrivateKey: makePrivateKey(),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("claimerDid");
  });

  it("returns validation error for missing taskId", async () => {
    const { handleHttpToolCall } = await import("@agentbadge/mcp");
    const result = await handleHttpToolCall("deliver_result_with_key", {
      claimerDid: VALID_DID,
      resultBody: "test result",
      claimerPrivateKey: makePrivateKey(),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("taskId");
  });

  it("returns validation error for missing claimerPrivateKey", async () => {
    const { handleHttpToolCall } = await import("@agentbadge/mcp");
    const result = await handleHttpToolCall("deliver_result_with_key", {
      taskId: "task-1",
      claimerDid: VALID_DID,
      resultBody: "test result",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("claimerPrivateKey");
  });
});
