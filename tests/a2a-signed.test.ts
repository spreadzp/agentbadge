import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@agentbadge/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  submitA2AMessage: vi.fn(),
  verifyA2ADid: vi.fn(),
  getNftInfo: vi.fn(),
  getTopicMessages: vi.fn(),
  prepareA2ATopicMessage: vi.fn(),
  signTransactionBytes: vi.fn(),
  submitSignedTopicMessage: vi.fn(),
}));

vi.mock("@agentbadge/passport", async (importOriginal) => ({
  ...await importOriginal(),
  a2aUpsert: vi.fn(),
  getMessagesByTo: vi.fn(() => []),
  getConversation: vi.fn(() => []),
  a2aClear: vi.fn(),
  a2aRebuildFromHcs: vi.fn(),
  a2aStartBackgroundRebuild: vi.fn(),
}));

import { Hono } from "hono";
import { a2aRoutes } from "../src/server/routes/a2a";
import {
  prepareA2ATopicMessage,
  signTransactionBytes,
  submitSignedTopicMessage,
  verifyA2ADid,
} from "@agentbadge/hedera-core";
import { a2aUpsert as upsert } from "@agentbadge/passport";

const mockedPrepare = vi.mocked(prepareA2ATopicMessage);
const mockedSign = vi.mocked(signTransactionBytes);
const mockedSubmit = vi.mocked(submitSignedTopicMessage);
const mockedVerifyA2ADid = vi.mocked(verifyA2ADid);
const mockedUpsert = vi.mocked(upsert);

const DID_A = "did:hcs:0.0.1234567:1";
const DID_B = "did:hcs:0.0.7654321:2";
const ACCOUNT_A = "0.0.1234567";
const PRIVATE_KEY_A = "0xabc123";

function makeApp() {
  const app = new Hono();
  app.route("/", a2aRoutes);
  return app;
}

async function postSendWithKey(app: Hono, body: Record<string, unknown>) {
  const req = new Request("http://localhost/a2a/send-with-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return app.fetch(req);
}

async function postSendSigned(app: Hono, body: Record<string, unknown>) {
  const req = new Request("http://localhost/a2a/send-signed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return app.fetch(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedVerifyA2ADid.mockResolvedValue(true);
  mockedPrepare.mockResolvedValue({
    txBytes: "dGVzdA==",
    txId: "0.0.1234567@1700000000.000000000",
  });
  mockedSign.mockReturnValue({
    signature: JSON.stringify(["dGVzdFNpZw=="]),
    publicKey: "0xpubkey",
  });
  mockedSubmit.mockResolvedValue({ txId: "0.0.1234567@1700000000.000000001", consensusTimestamp: null });
});

describe("POST /a2a/send-with-key", () => {
  it("returns 200 and txId for valid signed message", async () => {
    const app = makeApp();
    const res = await postSendWithKey(app, {
      from: DID_A,
      to: DID_B,
      body: "Hello from signed A2A!",
      fromAccountId: ACCOUNT_A,
      privateKey: PRIVATE_KEY_A,
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.txId).toBeDefined();
    expect(mockedPrepare).toHaveBeenCalledWith(ACCOUNT_A, expect.objectContaining({
      from: DID_A,
      to: DID_B,
      body: "Hello from signed A2A!",
    }));
    expect(mockedSign).toHaveBeenCalledWith("dGVzdA==", PRIVATE_KEY_A);
    expect(mockedSubmit).toHaveBeenCalled();
    expect(mockedUpsert).toHaveBeenCalled();
  });

  it("returns 400 when fromAccountId is missing", async () => {
    const app = makeApp();
    const res = await postSendWithKey(app, {
      from: DID_A,
      to: DID_B,
      body: "Missing account",
      privateKey: PRIVATE_KEY_A,
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when privateKey is missing", async () => {
    const app = makeApp();
    const res = await postSendWithKey(app, {
      from: DID_A,
      to: DID_B,
      body: "Missing key",
      fromAccountId: ACCOUNT_A,
    });

    expect(res.status).toBe(400);
  });

  it("returns 403 when sender passport is invalid", async () => {
    mockedVerifyA2ADid.mockResolvedValueOnce(false);

    const app = makeApp();
    const res = await postSendWithKey(app, {
      from: DID_A,
      to: DID_B,
      body: "Should fail",
      fromAccountId: ACCOUNT_A,
      privateKey: PRIVATE_KEY_A,
    });

    expect(res.status).toBe(403);
  });

  it("returns 403 when recipient passport is invalid", async () => {
    mockedVerifyA2ADid
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const app = makeApp();
    const res = await postSendWithKey(app, {
      from: DID_A,
      to: DID_B,
      body: "Should fail",
      fromAccountId: ACCOUNT_A,
      privateKey: PRIVATE_KEY_A,
    });

    expect(res.status).toBe(403);
  });
});

describe("POST /a2a/send-signed", () => {
  it("returns 200 for valid pre-signed transaction", async () => {
    const app = makeApp();
    const res = await postSendSigned(app, {
      from: DID_A,
      to: DID_B,
      body: "Pre-signed message",
      txBytes: "dGVzdA==",
      publicKey: "0xpubkey",
      signature: JSON.stringify(["dGVzdFNpZw=="]),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.txId).toBeDefined();
    expect(mockedSubmit).toHaveBeenCalled();
    expect(mockedUpsert).toHaveBeenCalled();
  });

  it("returns 400 when txBytes is missing", async () => {
    const app = makeApp();
    const res = await postSendSigned(app, {
      from: DID_A,
      to: DID_B,
      body: "Missing txBytes",
      publicKey: "0xpubkey",
      signature: JSON.stringify(["dGVzdFNpZw=="]),
    });

    expect(res.status).toBe(400);
  });

  it("returns 403 when sender passport is invalid", async () => {
    mockedVerifyA2ADid.mockResolvedValueOnce(false);

    const app = makeApp();
    const res = await postSendSigned(app, {
      from: DID_A,
      to: DID_B,
      body: "Should fail",
      txBytes: "dGVzdA==",
      publicKey: "0xpubkey",
      signature: JSON.stringify(["dGVzdFNpZw=="]),
    });

    expect(res.status).toBe(403);
  });
});

describe("Signed conversation flow", () => {
  it("full flow: send with key → verify cache → conversation", async () => {
    const app = makeApp();

    const res = await postSendWithKey(app, {
      from: DID_A,
      to: DID_B,
      body: "Signed conversation test",
      fromAccountId: ACCOUNT_A,
      privateKey: PRIVATE_KEY_A,
    });

    expect(res.status).toBe(200);
    expect(mockedPrepare).toHaveBeenCalledTimes(1);
    expect(mockedSign).toHaveBeenCalledTimes(1);
    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        from: DID_A,
        to: DID_B,
        body: "Signed conversation test",
        txId: expect.any(String),
      }),
    );
  });
});
