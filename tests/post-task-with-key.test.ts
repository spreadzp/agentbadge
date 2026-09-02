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

describe("SLICE-15-3: POST /market/tasks/signed — agent-signed HCS task posting", () => {
  beforeAll(() => {
    setupMockEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 for missing posterDid", async () => {
    const app = makeTestApp();
    const res = await app.request("/market/tasks/signed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Test task",
        description: "Test description",
        priceHbar: 1,
        capabilities: ["data_analysis"],
        posterPrivateKey: makePrivateKey(),
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("posterDid");
  });

  it("returns 400 for missing title", async () => {
    const app = makeTestApp();
    const res = await app.request("/market/tasks/signed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: "did:hcs:0.0.123:1",
        description: "Test description",
        priceHbar: 1,
        capabilities: ["data_analysis"],
        posterPrivateKey: makePrivateKey(),
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("title");
  });

  it("returns 400 for missing posterPrivateKey", async () => {
    const app = makeTestApp();
    const res = await app.request("/market/tasks/signed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: "did:hcs:0.0.123:1",
        title: "Test task",
        description: "Test description",
        priceHbar: 1,
        capabilities: ["data_analysis"],
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("posterPrivateKey");
  });

  it("returns 400 for invalid posterDid format", async () => {
    const app = makeTestApp();
    const res = await app.request("/market/tasks/signed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: "invalid-did",
        title: "Test task",
        description: "Test description",
        priceHbar: 1,
        capabilities: ["data_analysis"],
        posterPrivateKey: makePrivateKey(),
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("posterDid");
  });

  it("returns 400 for empty capabilities", async () => {
    const app = makeTestApp();
    const res = await app.request("/market/tasks/signed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: "did:hcs:0.0.123:1",
        title: "Test task",
        description: "Test description",
        priceHbar: 1,
        capabilities: [],
        posterPrivateKey: makePrivateKey(),
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("capabilities");
  });

  it("returns 400 for non-positive priceHbar", async () => {
    const app = makeTestApp();
    const res = await app.request("/market/tasks/signed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: "did:hcs:0.0.123:1",
        title: "Test task",
        description: "Test description",
        priceHbar: 0,
        capabilities: ["data_analysis"],
        posterPrivateKey: makePrivateKey(),
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("priceHbar");
  });

  it("private key is never included in response body", async () => {
    const app = makeTestApp();
    const pk = makePrivateKey();
    const res = await app.request("/market/tasks/signed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: "did:hcs:0.0.123:1",
        title: "Test task",
        description: "Test description",
        priceHbar: 1,
        capabilities: ["data_analysis"],
        posterPrivateKey: pk,
      }),
    });
    const text = await res.text();
    expect(text).not.toContain(pk);
  });
});

describe("SLICE-15-3: post_task_with_key MCP tool", () => {
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

  it("listTools() includes post_task_with_key", () => {
    const tools = listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("post_task_with_key");
  });

  it("returns validation error for missing posterDid", async () => {
    const { handleHttpToolCall } = await import("@agentbadge/mcp");
    const result = await handleHttpToolCall("post_task_with_key", {
      title: "Test task",
      description: "Test description",
      priceHbar: 1,
      capabilities: ["data_analysis"],
      posterPrivateKey: makePrivateKey(),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("posterDid");
  });

  it("returns validation error for missing posterPrivateKey", async () => {
    const { handleHttpToolCall } = await import("@agentbadge/mcp");
    const result = await handleHttpToolCall("post_task_with_key", {
      posterDid: "did:hcs:0.0.123:1",
      title: "Test task",
      description: "Test description",
      priceHbar: 1,
      capabilities: ["data_analysis"],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("posterPrivateKey");
  });

  it("returns validation error for missing title", async () => {
    const { handleHttpToolCall } = await import("@agentbadge/mcp");
    const result = await handleHttpToolCall("post_task_with_key", {
      posterDid: "did:hcs:0.0.123:1",
      description: "Test description",
      priceHbar: 1,
      capabilities: ["data_analysis"],
      posterPrivateKey: makePrivateKey(),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("title");
  });
});
