// SLICE-258-5: MPP (WWW-Authenticate: Payment) recipient evidence —
// challenge parser + l402 double-probe + x402 probe mppQuotes.
// No live network: transports are injected.
import { describe, it, expect } from "vitest";
import {
  parsePaymentChallengeQuotes,
  mppQuotesDivergent,
} from "../../../src/agent-readiness/scanner/fetchers/mpp-payment-challenge";
import { fetchL402Challenge } from "../../../src/agent-readiness/scanner/fetchers/l402-fetcher";
import { fetchX402Discovery } from "../../../src/agent-readiness/scanner/fetchers/x402-fetcher";

const ADDR_A = "0xaaaabbbbccccddddeeeeffff0000111122223333";
const ADDR_B = "0x1111222233334444555566667777888899990000";

const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64");
const b64url = (obj: unknown) =>
  Buffer.from(JSON.stringify(obj)).toString("base64url");

const stripeReq = (recipient: string, amount = "10") =>
  b64url({ amount, currency: "usd", recipient });
const tempoReq = (payTo: string, network = "eip155:8453", asset = "USDC") =>
  b64({ x402Version: 1, accepts: [{ scheme: "exact", network, asset, payTo }] });

describe("parsePaymentChallengeQuotes", () => {
  it("extracts stripe recipient from Payment challenge", () => {
    const q = parsePaymentChallengeQuotes(
      `Payment method="stripe", request="${stripeReq(ADDR_A)}"`,
    );
    expect(q).toEqual([{ method: "stripe", payTo: ADDR_A }]);
  });

  it("extracts tempo x402 accepts[].payTo", () => {
    const q = parsePaymentChallengeQuotes(
      `Payment method="tempo", request="${tempoReq(ADDR_A, "eip155:5042002", "USDC")}"`,
    );
    expect(q).toEqual([
      { method: "tempo", payTo: ADDR_A, network: "eip155:5042002", asset: "USDC" },
    ]);
  });

  it("handles multiple challenges in one header (our mpp middleware shape)", () => {
    const header = [
      `Payment method="tempo", request="${tempoReq(ADDR_A)}"`,
      `Payment method="stripe", request="${stripeReq(ADDR_B)}"`,
    ].join(", ");
    const q = parsePaymentChallengeQuotes(header);
    expect(q).toHaveLength(2);
    expect(q.map((x) => x.method).sort()).toEqual(["stripe", "tempo"]);
  });

  it("tolerates extra params and param order", () => {
    const q = parsePaymentChallengeQuotes(
      `Payment realm="api", method="stripe", amount="5", request="${stripeReq(ADDR_A)}"`,
    );
    expect(q).toEqual([{ method: "stripe", payTo: ADDR_A }]);
  });

  it("ignores non-Payment schemes, malformed b64 and missing request", () => {
    expect(
      parsePaymentChallengeQuotes(`Basic realm="x", Payment method="stripe"`),
    ).toEqual([]);
    expect(
      parsePaymentChallengeQuotes(`Payment method="stripe", request="!!!notb64"`),
    ).toEqual([]);
    expect(
      parsePaymentChallengeQuotes(`Bearer abc123`),
    ).toEqual([]);
    expect(parsePaymentChallengeQuotes(undefined)).toEqual([]);
  });
});

describe("mppQuotesDivergent", () => {
  const q = (payTo: string, method = "stripe") => ({ method, payTo });
  it("identical recipient sets → not divergent", () => {
    expect(mppQuotesDivergent([q(ADDR_A)], [q(ADDR_A)])).toBe(false);
  });
  it("different recipients → divergent (possible per-payment)", () => {
    expect(mppQuotesDivergent([q(ADDR_A)], [q(ADDR_B)])).toBe(true);
  });
  it("empty on either side → not divergent", () => {
    expect(mppQuotesDivergent([], [q(ADDR_A)])).toBe(false);
  });
});

describe("fetchL402Challenge — double-probe (C5/D-258-Q12)", () => {
  const wwwAuth = (r: string) => ({
    "www-authenticate": `Payment method="stripe", request="${stripeReq(r)}"`,
  });
  const transport =
    (seq: { status: number; headers: Record<string, string>; body: string }[]) =>
    async () => {
      const next = seq.shift();
      if (!next) throw new Error("no more responses");
      return next;
    };

  it("runs the same POST twice and exposes secondAttempt headers", async () => {
    const calls: string[] = [];
    const r = await fetchL402Challenge("https://example.com", {
      transport: async (url) => {
        calls.push(url);
        return { status: 402, headers: wwwAuth(ADDR_A), body: "{}" };
      },
    });
    expect(calls).toEqual([
      "https://example.com/passport/request",
      "https://example.com/passport/request",
    ]);
    expect(r.status).toBe(402);
    expect(r.secondAttempt?.status).toBe(402);
    expect(r.secondAttempt?.headers["www-authenticate"]).toContain(
      'method="stripe"',
    );
  });

  it("second transport failure → secondAttempt status 0, never throws", async () => {
    const r = await fetchL402Challenge("https://example.com", {
      transport: transport([
        { status: 402, headers: wwwAuth(ADDR_A), body: "{}" },
      ]),
    });
    expect(r.status).toBe(402);
    expect(r.secondAttempt?.status).toBe(0);
  });

  it("first failure still double-probes (both attempts recorded)", async () => {
    const r = await fetchL402Challenge("https://example.com", {
      transport: async () => {
        throw new Error("boom");
      },
    });
    expect(r.status).toBe(0);
    expect(r.secondAttempt?.status).toBe(0);
  });
});

describe("x402 probes — mppQuotes capture (mixed-protocol endpoints)", () => {
  it("attempt.mppQuotes populated from www-authenticate Payment challenges", async () => {
    const stripeHeader = `Payment method="stripe", request="${stripeReq(ADDR_A)}"`;
    const r = await fetchX402Discovery("https://example.com", {
      manifestResult: {
        status: 200,
        body: JSON.stringify({ services: [{ method: "GET", path: "/paid" }] }),
        resolvedIp: null,
      },
      probeFn: async () => ({
        status: 402,
        observedAt: "t",
        accepts: [{ payTo: ADDR_B }],
        mppQuotes: [{ method: "stripe", payTo: ADDR_A }],
      }),
    });
    expect(r.probes[0].attempts[0].mppQuotes).toEqual([
      { method: "stripe", payTo: ADDR_A },
    ]);
    void stripeHeader;
  });

  it("mppDivergent flagged when second probe quotes a different recipient", async () => {
    let n = 0;
    const r = await fetchX402Discovery("https://example.com", {
      manifestResult: {
        status: 200,
        body: JSON.stringify({ services: [{ method: "GET", path: "/paid" }] }),
        resolvedIp: null,
      },
      probeFn: async () => ({
        status: 402,
        observedAt: "t",
        accepts: [{ payTo: ADDR_B }],
        mppQuotes: [{ method: "stripe", payTo: ++n === 1 ? ADDR_A : ADDR_B }],
      }),
    });
    expect(r.probes[0].mppDivergent).toBe(true);
    expect(r.probes[0].divergent).toBe(false); // payTo identical — no x402 divergence
  });

  it("identical mpp recipient sets → mppDivergent false", async () => {
    const r = await fetchX402Discovery("https://example.com", {
      manifestResult: {
        status: 200,
        body: JSON.stringify({ services: [{ method: "GET", path: "/paid" }] }),
        resolvedIp: null,
      },
      probeFn: async () => ({
        status: 402,
        observedAt: "t",
        accepts: [{ payTo: ADDR_A }],
        mppQuotes: [{ method: "stripe", payTo: ADDR_A }],
      }),
    });
    expect(r.probes[0].mppDivergent).toBe(false);
  });
});
