// SLICE-258-9: offer-and-receipt extension capture (AB-190).
// The extension declares signed offers in the payment-requirements
// response: `extensions["offer-receipt"].info.offers[]` — each offer
// {format: "eip712"|"jws", payload?, signature, acceptIndex?}
// (specs/extensions/extension-offer-and-receipt.md). Detection is
// presence-only: we record that the extension is declared and count
// well-formed offers — signatures are NOT verified (C9).
import { describe, it, expect } from "vitest";
import { offerReceiptFromPaymentPayload } from "../../../src/agent-readiness/scanner/fetchers/offer-receipt-extension";
import {
  fetchX402Discovery,
  type X402ProbeAttempt,
} from "../../../src/agent-readiness/scanner/fetchers/x402-fetcher";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

const eip712Offer = {
  format: "eip712",
  acceptIndex: 0,
  payload: {
    version: 1,
    resourceUrl: "https://api.example.com/x",
    scheme: "exact",
    network: "eip155:8453",
    asset: "0xUSDC",
    payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
    amount: "10000",
    validUntil: 9999999999,
  },
  signature: "0xdeadbeef".repeat(8),
};

const jwsOffer = {
  format: "jws",
  signature: "eyJhbGciOiJFZERTQSJ9.eyJ2ZXJzaW9uIjoxfQ.c2ln",
};

const offerExt = (offers: unknown[]) => ({
  "offer-receipt": { info: { offers } },
});

const payReqDoc = (extensions?: unknown) => ({
  x402Version: 2,
  resource: { url: "https://api.example.com/x" },
  accepts: [{ scheme: "exact", network: "eip155:8453", amount: "10000", payTo: "0xPAYTO" }],
  ...(extensions ? { extensions } : {}),
});

describe("offerReceiptFromPaymentPayload", () => {
  it("reads offers[] from a payment-required header doc", () => {
    const headers = { "payment-required": b64(payReqDoc(offerExt([eip712Offer]))) };
    const r = offerReceiptFromPaymentPayload(headers, null);
    expect(r).toEqual({ declared: true, offers: 1, formats: ["eip712"] });
  });

  it("reads offers[] from www-authenticate request= param", () => {
    const headers = {
      "www-authenticate": `Payment method="tempo", request="${b64(payReqDoc(offerExt([jwsOffer])))}"`,
    };
    const r = offerReceiptFromPaymentPayload(headers, null);
    expect(r?.declared).toBe(true);
    expect(r?.formats).toEqual(["jws"]);
  });

  it("reads offers[] from a JSON body (x402 v1 shape)", () => {
    const r = offerReceiptFromPaymentPayload(
      {},
      JSON.stringify(payReqDoc(offerExt([eip712Offer, jwsOffer]))),
    );
    expect(r).toEqual({ declared: true, offers: 2, formats: ["eip712", "jws"] });
  });

  it("returns null when the doc has no extensions field", () => {
    const headers = { "payment-required": b64(payReqDoc()) };
    expect(offerReceiptFromPaymentPayload(headers, null)).toBeNull();
  });

  it("returns null when extensions exist but offer-receipt is absent", () => {
    const ext = { bazaar: { info: { inputSchema: {} } } };
    const headers = { "payment-required": b64(payReqDoc(ext)) };
    expect(offerReceiptFromPaymentPayload(headers, null)).toBeNull();
  });

  it("returns null on undecodable input", () => {
    expect(offerReceiptFromPaymentPayload({}, "not json")).toBeNull();
    expect(offerReceiptFromPaymentPayload({}, null)).toBeNull();
  });

  it("flags malformed: offer-receipt present but info.offers not an array", () => {
    const bad = { "offer-receipt": { info: { nope: 1 } } };
    const r = offerReceiptFromPaymentPayload({}, JSON.stringify(payReqDoc(bad)));
    expect(r?.declared).toBe(true);
    expect(r?.malformed).toBe(true);
    expect(r?.offers).toBe(0);
  });

  it("flags malformed: offers empty array", () => {
    const r = offerReceiptFromPaymentPayload(
      {},
      JSON.stringify(payReqDoc(offerExt([]))),
    );
    expect(r?.malformed).toBe(true);
    expect(r?.offers).toBe(0);
  });

  it("flags malformed: offer missing signature", () => {
    const broken = { format: "eip712", payload: { version: 1 } };
    const r = offerReceiptFromPaymentPayload(
      {},
      JSON.stringify(payReqDoc(offerExt([broken]))),
    );
    expect(r?.malformed).toBe(true);
    expect(r?.offers).toBe(0);
  });

  it("flags malformed: unknown format value", () => {
    const broken = { format: "pgp", signature: "x" };
    const r = offerReceiptFromPaymentPayload(
      {},
      JSON.stringify(payReqDoc(offerExt([broken]))),
    );
    expect(r?.malformed).toBe(true);
  });

  it("counts well-formed offers and flags partial garbage honestly", () => {
    const r = offerReceiptFromPaymentPayload(
      {},
      JSON.stringify(payReqDoc(offerExt([eip712Offer, { format: "x" }]))),
    );
    expect(r?.declared).toBe(true);
    expect(r?.offers).toBe(1);
    expect(r?.formats).toEqual(["eip712"]);
    expect(r?.malformed).toBe(true);
  });

  it("prefers payment-required header over body", () => {
    const headers = { "payment-required": b64(payReqDoc(offerExt([eip712Offer]))) };
    const body = JSON.stringify(payReqDoc(offerExt([jwsOffer, eip712Offer])));
    const r = offerReceiptFromPaymentPayload(headers, body);
    expect(r?.offers).toBe(1);
    expect(r?.formats).toEqual(["eip712"]);
  });
});

describe("fetchX402Discovery — offerReceipt capture", () => {
  const attempt = (extra: Partial<X402ProbeAttempt>): X402ProbeAttempt => ({
    status: 402,
    observedAt: "2026-11-22T12:00:00Z",
    accepts: [{ payTo: "0xPAY" }],
    mppQuotes: [],
    ...extra,
  });

  it("carries offerReceipt through the double-probe snapshot", async () => {
    const offerReceipt = { declared: true, offers: 1, formats: ["eip712"] };
    const result = await fetchX402Discovery("https://example.com", {
      manifestResult: {
        status: 200,
        body: JSON.stringify({ services: [{ method: "GET", path: "/paid" }] }),
        resolvedIp: null,
      },
      probeFn: async () => attempt({ offerReceipt }),
    });
    expect(result.probes[0]?.attempts[0]?.offerReceipt).toEqual(offerReceipt);
    expect(result.probes[0]?.attempts[1]?.offerReceipt).toEqual(offerReceipt);
  });

  it("leaves offerReceipt absent when the probe saw no extension", async () => {
    const result = await fetchX402Discovery("https://example.com", {
      manifestResult: {
        status: 200,
        body: JSON.stringify({ services: [{ method: "GET", path: "/paid" }] }),
        resolvedIp: null,
      },
      probeFn: async () => attempt({}),
    });
    expect(result.probes[0]?.attempts[0]?.offerReceipt).toBeUndefined();
  });
});
