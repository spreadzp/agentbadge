/**
 * Tests for SLICE-15-1: sign_transaction MCP tool + POST /market/sign endpoint
 *
 * Tests:
 * 1. sign_transaction tool appears in listTools() after registerSigningTools()
 * 2. POST /market/sign with valid txBytes + privateKey returns { signature, publicKey }
 * 3. POST /market/sign with missing txBytes returns 400
 * 4. POST /market/sign with missing privateKey returns 400
 * 5. POST /market/sign with invalid txBytes returns 400
 * 6. POST /market/sign with invalid privateKey returns 400
 * 7. Works with ED25519 key format (302e...)
 * 8. Works with ECDSA key format (0x...)
 * 9. POST /mcp/tools/sign_transaction returns signature via MCP handler
 * 10. Private key is not echoed in response
 */

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

import { Client, PrivateKey, TransferTransaction, Hbar } from "@hashgraph/sdk";
import { signTransactionBytes } from "@agentbadge/hedera-core";

const BASE_URL = "http://localhost:4021";

// Generate a real frozen transfer transaction for testing
function makeFrozenTransferTxBytes(): { txBytes: string; privateKey: PrivateKey; accountId: string } {
  // Generate a test key pair
  const privateKey = PrivateKey.generateED25519();
  const accountId = "0.0.12345";

  // Create a frozen transfer transaction (no network needed for freezing)
  const client = Client.forTestnet();
  client.setOperator(accountId, privateKey);

  const tx = new TransferTransaction()
    .addHbarTransfer(accountId, Hbar.fromTinybars(-100))
    .addHbarTransfer("0.0.67890", Hbar.fromTinybars(100));

  tx.freezeWith(client);
  const txBytes = Buffer.from(tx.toBytes()).toString("base64");
  client.close();

  return { txBytes, privateKey, accountId };
}

function makeFrozenTransferTxBytesECDSA(): { txBytes: string; privateKey: PrivateKey; accountId: string } {
  const privateKey = PrivateKey.generateECDSA();
  const accountId = "0.0.22222";

  const client = Client.forTestnet();
  client.setOperator(accountId, privateKey);

  const tx = new TransferTransaction()
    .addHbarTransfer(accountId, Hbar.fromTinybars(-50))
    .addHbarTransfer("0.0.33333", Hbar.fromTinybars(50));

  tx.freezeWith(client);
  const txBytes = Buffer.from(tx.toBytes()).toString("base64");
  client.close();

  return { txBytes, privateKey, accountId };
}

describe("SLICE-15-1: POST /market/sign — signing endpoint", () => {
  beforeAll(() => {
    setupMockEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns { signature, publicKey } for valid txBytes + ED25519 privateKey", async () => {
    const { txBytes, privateKey } = makeFrozenTransferTxBytes();
    const app = makeTestApp();
    const res = await app.request("/market/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        txBytes,
        privateKey: privateKey.toStringDer(),
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.signature).toBeDefined();
    expect(typeof data.signature).toBe("string");
    expect(data.publicKey).toBeDefined();
    expect(typeof data.publicKey).toBe("string");
    expect(data.publicKey).toBe(privateKey.publicKey.toStringDer());
    // signature is a JSON-encoded array of base64 strings
    const sigArr = JSON.parse(data.signature);
    expect(Array.isArray(sigArr)).toBe(true);
    expect(sigArr.length).toBeGreaterThan(0);
  });

  it("returns { signature, publicKey } for valid txBytes + ECDSA privateKey (0x hex)", async () => {
    const { txBytes, privateKey } = makeFrozenTransferTxBytesECDSA();
    const app = makeTestApp();
    const res = await app.request("/market/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        txBytes,
        privateKey: `0x${privateKey.toStringDer()}`,
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.signature).toBeDefined();
    expect(data.publicKey).toBeDefined();
    expect(data.publicKey).toBe(privateKey.publicKey.toStringDer());
    const sigArr = JSON.parse(data.signature);
    expect(Array.isArray(sigArr)).toBe(true);
    expect(sigArr.length).toBeGreaterThan(0);
  });

  it("returns 400 for missing txBytes", async () => {
    const app = makeTestApp();
    const res = await app.request("/market/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        privateKey: "302e020100300506032b657004220420deadbeef",
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("txBytes");
  });

  it("returns 400 for missing privateKey", async () => {
    const { txBytes } = makeFrozenTransferTxBytes();
    const app = makeTestApp();
    const res = await app.request("/market/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txBytes }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("privateKey");
  });

  it("returns 400 for invalid txBytes (not base64)", async () => {
    const app = makeTestApp();
    const res = await app.request("/market/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        txBytes: "!!!not-valid-base64!!!",
        privateKey: "302e020100300506032b657004220420deadbeef",
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("returns 400 for invalid privateKey", async () => {
    const { txBytes } = makeFrozenTransferTxBytes();
    const app = makeTestApp();
    const res = await app.request("/market/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        txBytes,
        privateKey: "not-a-valid-key",
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("does not echo privateKey in response", async () => {
    const { txBytes, privateKey } = makeFrozenTransferTxBytes();
    const app = makeTestApp();
    const res = await app.request("/market/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        txBytes,
        privateKey: privateKey.toStringDer(),
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const dataStr = JSON.stringify(data);
    // Private key should never appear in response
    expect(dataStr).not.toContain(privateKey.toStringDer());
    expect(dataStr).not.toContain(privateKey.toStringRaw());
  });

  it("signature matches signTransactionBytes output", async () => {
    const { txBytes, privateKey } = makeFrozenTransferTxBytes();
    const app = makeTestApp();
    const res = await app.request("/market/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        txBytes,
        privateKey: privateKey.toStringDer(),
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    // Compare with direct signTransactionBytes call
    const expected = signTransactionBytes(txBytes, privateKey.toStringDer());
    expect(data.signature).toBe(expected.signature);
    expect(data.publicKey).toBe(expected.publicKey);
  });
});

describe("SLICE-15-1: sign_transaction MCP tool registration", () => {
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

  it("listTools() includes sign_transaction", () => {
    // This test will fail until registerSigningTools is called
    const tools = listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("sign_transaction");
  });
});

describe("SLICE-15-1: POST /mcp/tools/sign_transaction — MCP handler", () => {
  beforeAll(() => {
    setupMockEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns signature + publicKey via MCP tool handler", async () => {
    const { txBytes, privateKey } = makeFrozenTransferTxBytes();

    // Use signTransactionBytes for correct format
    const expected = signTransactionBytes(txBytes, privateKey.toStringDer());
    const mockResponse = expected;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/market/sign")) {
        return new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    const app = makeTestApp();
    const res = await app.request("/mcp/tools/sign_transaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        txBytes,
        privateKey: privateKey.toStringDer(),
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isError).toBeFalsy();
    const parsed = JSON.parse(data.content[0].text);
    expect(parsed.signature).toBeDefined();
    expect(parsed.publicKey).toBeDefined();
  });

  it("returns validation error for missing txBytes", async () => {
    const app = makeTestApp();
    const res = await app.request("/mcp/tools/sign_transaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        privateKey: "302e020100300506032b657004220420deadbeef",
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isError).toBe(true);
    expect(data.content[0].text).toContain("txBytes");
  });
});
