import { describe, expect, it } from "vitest";
import {
  base64url,
  buildAuthorizeUrl,
  createCookieJar,
  GEC_ENDPOINTS,
  GEC_BID_AMOUNT_MINOR,
  GEC_TARGET_DEMAND,
  makeState,
  pkce,
  redact,
  responseShapeOf,
  Transcript,
  verifyState,
} from "../scripts/gec-interop.mts";
import { createHash } from "node:crypto";

// SLICE-205-3: pure-function unit tests — zero network calls.

describe("pkce (RFC 7636 S256)", () => {
  it("verifier is 43-128 chars of base64url alphabet", () => {
    const { verifier } = pkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it("challenge == base64url(sha256(verifier)) — RFC 7636 Appendix B vector", () => {
    // Appendix B: verifier dBjftJeZ…EjXk → challenge E9Melhoa…w-cM
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("verifier/challenge differ across calls (randomness)", () => {
    const a = pkce();
    const b = pkce();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });
});

describe("buildAuthorizeUrl", () => {
  const url = buildAuthorizeUrl({
    clientId: "https://agentbadge.xyz/.well-known/gec-client.json",
    redirectUri: "https://agentbadge.xyz/api/gec/callback",
    state: "teststate123",
    codeChallenge: "chal",
  });

  it("carries the full machine_entry parameter set", () => {
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://live-sasame.sasame.online/authorize");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe(
      "https://agentbadge.xyz/.well-known/gec-client.json",
    );
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://agentbadge.xyz/api/gec/callback",
    );
    expect(u.searchParams.get("scope")).toBe("gec.read gec.write");
    expect(u.searchParams.get("resource")).toBe("https://live-sasame.sasame.online/mcp");
    expect(u.searchParams.get("state")).toBe("teststate123");
    expect(u.searchParams.get("code_challenge")).toBe("chal");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("cookieJar (per-origin — audit H-2)", () => {
  const res = (cookies: string[]) =>
    ({ headers: { getSetCookie: () => cookies } }) as unknown as Response;

  it("captures Set-Cookie pairs scoped to the response origin", () => {
    const jar = createCookieJar();
    jar.capture(res(["sess=abc; Path=/; HttpOnly", "pref=dark; Path=/"]), "https://sasame.online");
    expect(jar.header("https://sasame.online")).toBe("sess=abc; pref=dark");
    expect(jar.names()["https://sasame.online"].sort()).toEqual(["pref", "sess"]);
  });

  it("never leaks cookies across origins (session-fixation guard)", () => {
    const jar = createCookieJar();
    jar.capture(res(["evil=fixated"]), "https://live-vps.sasame.online");
    expect(jar.header("https://live-sasame.sasame.online")).toBeUndefined();
    expect(jar.header("https://live-vps.sasame.online")).toBe("evil=fixated");
    jar.capture(res(["real=ok"]), "https://live-sasame.sasame.online");
    expect(jar.header("https://live-sasame.sasame.online")).toBe("real=ok");
  });

  it("empty jar yields undefined; later Set-Cookie overrides; empty value deletes (M-4)", () => {
    const jar = createCookieJar();
    expect(jar.header("https://x.test")).toBeUndefined();
    jar.capture(res(["a=1"]), "https://x.test");
    jar.capture(res(["a=2"]), "https://x.test");
    expect(jar.header("https://x.test")).toBe("a=2");
    jar.capture(res(["a=; Max-Age=0"]), "https://x.test");
    expect(jar.header("https://x.test")).toBeUndefined();
  });

  it("skips malformed lines (no name, no equals)", () => {
    const jar = createCookieJar();
    jar.capture(res(["=novalue", "justflag", "ok=1"]), "https://x.test");
    expect(jar.header("https://x.test")).toBe("ok=1");
  });
});

describe("state↔verifier binding (audit H-1)", () => {
  it("verifyState accepts a state made for the same verifier, rejects others", () => {
    const { verifier } = pkce();
    const state = makeState(verifier);
    expect(verifyState(state, verifier)).toBe(true);

    const other = pkce();
    expect(verifyState(state, other.verifier)).toBe(false);
    expect(verifyState(makeState(other.verifier), verifier)).toBe(false);
  });

  it("rejects malformed/forged states", () => {
    const { verifier } = pkce();
    expect(verifyState("noDotHere", verifier)).toBe(false);
    expect(verifyState("seed.", verifier)).toBe(false);
    expect(verifyState(".tag", verifier)).toBe(false);
    expect(verifyState("", verifier)).toBe(false);
    const state = makeState(verifier);
    const [seed] = state.split(".");
    expect(verifyState(`${seed}.AAAAAAAAAAAAAAA`, verifier)).toBe(false);
  });
});

describe("redaction", () => {
  it("masks denylisted keys recursively, keeps whitelist fields", () => {
    const shaped = responseShapeOf({
      access_token: "tok-secret",
      nested: { signature: "sig-secret", ok: true },
      list: [{ cookie: "c=1" }, "keep"],
      path: "/mcp",
      status: 200,
      ms: 42,
    }) as Record<string, unknown>;
    expect(shaped.access_token).toBe("<redacted>");
    expect((shaped.nested as Record<string, unknown>).signature).toBe("<redacted>");
    expect((shaped.nested as Record<string, unknown>).ok).toBe(true);
    expect((shaped.list as unknown[])[0]).toEqual({ cookie: "<redacted>" });
    expect(shaped.path).toBe("/mcp");
    expect(shaped.status).toBe(200);
    expect(shaped.ms).toBe(42);
  });

  it("masks code/state/challenge/message/mcp_state values", () => {
    const shaped = redact({
      code: "authcode",
      state: "st",
      challenge: "c",
      message: "sign me",
      mcp_state: "ms",
      mcp_base: "mb",
    });
    for (const v of Object.values(shaped)) expect(v).toBe("<redacted>");
  });

  it("truncates long string values", () => {
    const shaped = redact({ body: "x".repeat(600) }) as { body: string };
    expect(shaped.body.length).toBeLessThan(600);
    expect(shaped.body).toContain("<truncated>");
  });
});

describe("Transcript", () => {
  it("records whitelisted fields and redacts responseShape at write time", () => {
    const t = new Transcript();
    t.record({
      step: "token",
      method: "POST",
      path: "/token",
      status: 200,
      ms: 120,
      responseShape: { access_token: "SECRET", token_type: "Bearer" },
    });
    const entry = t.entries[0];
    expect(entry.path).toBe("/token");
    expect((entry.responseShape as Record<string, unknown>).access_token).toBe(
      "<redacted>",
    );
    // Over-masking is intentional: "token" is a substring of "token_type", and
    // on a secret boundary masking a constant beats leaking a value.
    expect((entry.responseShape as Record<string, unknown>).token_type).toBe(
      "<redacted>",
    );
    const json = t.toJSON();
    expect(json).not.toContain("SECRET");
  });
});

describe("constants sanity", () => {
  it("target demand + bid amount match the live projection baseline", () => {
    expect(GEC_TARGET_DEMAND).toBe("demand:owner:aefcd63292d520374a1c2ac7fca6a8a5");
    expect(GEC_BID_AMOUNT_MINOR).toBe("5000000");
    expect(GEC_ENDPOINTS.chainId).toBe("0x2105");
    expect(GEC_ENDPOINTS.publicMcp).not.toBe(GEC_ENDPOINTS.resource);
  });
});
