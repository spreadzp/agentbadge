import { describe, expect, it } from "vitest";
import {
  parsePhase,
  base64url,
  buildAuthorizeUrl,
  buildVerificationArgs,
  buildVerdictNote,
  createCookieJar,
  extractToolPayload,
  GEC_ENDPOINTS,
  GEC_BID_AMOUNT_MINOR,
  GEC_TARGET_DEMAND,
  GEC_VERIFY_AWARD,
  GEC_VERIFY_DELIVERABLE,
  makeState,
  pkce,
  redact,
  responseShapeOf,
  Transcript,
  verificationIdempotencyKey,
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

  it("verify constants pin the AgentPay award/deliverable from comments/2410.md", () => {
    expect(GEC_VERIFY_AWARD).toBe("award:5a8d25b52436ec1779757050f4f47242");
    expect(GEC_VERIFY_DELIVERABLE).toBe("deliverable:1bc4966a12177feeb19c416b02114762");
    expect(GEC_VERIFY_AWARD).not.toBe("award:155c2787a74b57b557dc6a69d3d4fb56"); // not our own award
  });
});

// ─── SLICE-205-10: verification-phase helpers (pure, zero network) ───────────

describe("verificationIdempotencyKey", () => {
  it("is deterministic per (award, deliverable, verdict)", () => {
    const k1 = verificationIdempotencyKey(GEC_VERIFY_AWARD, GEC_VERIFY_DELIVERABLE, "FAIL");
    const k2 = verificationIdempotencyKey(GEC_VERIFY_AWARD, GEC_VERIFY_DELIVERABLE, "FAIL");
    expect(k1).toBe(k2);
  });

  it("differs per verdict so a deliberate change is a new key, not an overwrite", () => {
    const fail = verificationIdempotencyKey(GEC_VERIFY_AWARD, GEC_VERIFY_DELIVERABLE, "FAIL");
    const pass = verificationIdempotencyKey(GEC_VERIFY_AWARD, GEC_VERIFY_DELIVERABLE, "PASS");
    expect(fail).not.toBe(pass);
  });

  it("stays inside the schema bound (8-128 chars)", () => {
    const k = verificationIdempotencyKey(GEC_VERIFY_AWARD, GEC_VERIFY_DELIVERABLE, "REVISE");
    expect(k.length).toBeGreaterThanOrEqual(8);
    expect(k.length).toBeLessThanOrEqual(128);
  });
});

describe("buildVerdictNote", () => {
  const rows = [
    { criterion: "independently controlled external customer", met: false, evidence: "worker reports none; no payer visible" },
    { criterion: "deliverable received, scope completed", met: true, evidence: "deliverable:1bc49… state DELIVERED" },
    { criterion: "external wallet payment verified", met: null, evidence: "no tx_hash in evidence" },
  ];

  it("marks each criterion MET/UNMET/INDETERMINATE with evidence", () => {
    const note = buildVerdictNote("FAIL", rows);
    expect(note).toContain("Verdict FAIL");
    expect(note).toContain("[UNMET] independently controlled external customer");
    expect(note).toContain("[MET] deliverable received");
    expect(note).toContain("[INDETERMINATE] external wallet payment");
    expect(note).toContain("not worker self-report");
  });

  it("truncates to the 2000-char schema bound", () => {
    const huge = Array.from({ length: 30 }, (_, i) => ({
      criterion: `criterion ${i} ${"x".repeat(200)}`,
      met: false,
      evidence: "y".repeat(200),
    }));
    expect(buildVerdictNote("FAIL", huge).length).toBeLessThanOrEqual(2000);
  });
});

describe("buildVerificationArgs", () => {
  it("conforms to the gec_verification_submit schema (required fields, bounds)", () => {
    const args = buildVerificationArgs("FAIL", "outcome evidence: no external revenue", [
      "evidence/verify-2026-10-24.json",
    ]) as Record<string, unknown>;
    expect(args.award_id).toBe(GEC_VERIFY_AWARD);
    expect(args.deliverable_id).toBe(GEC_VERIFY_DELIVERABLE);
    expect((args.idempotency_key as string).length).toBeGreaterThanOrEqual(8);
    expect(args.verdict).toBe("FAIL");
    expect(args.evidence_refs).toEqual(["evidence/verify-2026-10-24.json"]);
    expect(args.note).toBe("outcome evidence: no external revenue");
  });

  it("omits optional fields when empty", () => {
    const args = buildVerificationArgs("REVISE", "") as Record<string, unknown>;
    expect(args.evidence_refs).toBeUndefined();
    expect(args.note).toBeUndefined();
  });

  it("throws on note > 2000 chars (schema bound)", () => {
    expect(() => buildVerificationArgs("FAIL", "n".repeat(2001))).toThrow(/note too long/);
  });
});

describe("extractToolPayload", () => {
  it("unwraps the JSON text part from MCP tools/call content[]", () => {
    const result = {
      content: [
        { type: "text", text: "{\"ok\":true,\"demands\":[]}" },
      ],
    };
    expect(extractToolPayload(result)).toEqual({ ok: true, demands: [] });
  });

  it("falls back to structuredContent, then raw result", () => {
    expect(extractToolPayload({ structuredContent: { ok: 1 } })).toEqual({ ok: 1 });
    expect(extractToolPayload({ plain: true })).toEqual({ plain: true });
  });
});

// ─── SLICE-209-2: buyer-phase helpers (pure, zero network) ───────────
import {
  parsePhase,
  BUYER_CAP_MINOR,
  buildSasameRunArgs,
  buyerPhaseDone,
  demandDeadlineFrom,
  defaultBuyerStatePath,
  loadBuyerState,
  saveBuyerState,
  type BuyerState,
} from "../scripts/gec-interop.mts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("demandDeadlineFrom", () => {
  it("returns T+7d in strict ISO Z format matching the sasame_run pattern", () => {
    const d = demandDeadlineFrom(new Date("2026-11-03T00:00:00.000Z"));
    expect(d).toBe("2026-11-10T00:00:00.000Z");
  });
});

describe("buildSasameRunArgs", () => {
  it("builds a buyer draft call: role=buyer, action=draft, plan_only default", () => {
    const args = buildSasameRunArgs({
      goal: "Create a production project draft for the synthesis article demand",
      action: "draft",
      projectName: "AgentBadge synthesis article",
      budgetMinor: BUYER_CAP_MINOR,
      deadline: "2026-11-10T00:00:00.000Z",
    }) as Record<string, unknown>;
    expect(args.execution_mode).toBe("plan_only");
    const gec = (args.context as { gec: Record<string, unknown> }).gec;
    expect(gec.role).toBe("buyer");
    expect(gec.action).toBe("draft");
    expect(gec.project_name).toBe("AgentBadge synthesis article");
    expect(gec.budget_minor).toBe("3500000");
    expect(gec.deadline).toBe("2026-11-10T00:00:00.000Z");
  });

  it("publish action carries confirmed:true (schema requires it before publish)", () => {
    const args = buildSasameRunArgs({
      goal: "Publish the demand",
      action: "publish",
      demandId: "demand:x",
      confirmed: true,
      executionMode: "auto",
    }) as Record<string, unknown>;
    const gec = (args.context as { gec: Record<string, unknown> }).gec;
    expect(gec.action).toBe("publish");
    expect(gec.confirmed).toBe(true);
    expect(gec.demand_id).toBe("demand:x");
    expect(args.execution_mode).toBe("auto");
  });

  it("omits absent optional fields (additionalProperties:false schema)", () => {
    const args = buildSasameRunArgs({ goal: "status", action: "status", demandId: "demand:y" }) as Record<string, unknown>;
    const gec = (args.context as { gec: Record<string, unknown> }).gec;
    expect(gec.project_id).toBeUndefined();
    expect(gec.budget_minor).toBeUndefined();
    expect(gec.confirmed).toBeUndefined();
    expect(gec.demand_id).toBe("demand:y");
  });

  it("BUYER_CAP_MINOR is 3.5 USDC = 3,500,000 microUSDC (D-209-4)", () => {
    expect(BUYER_CAP_MINOR).toBe("3500000");
  });
});

describe("buyer state file (idempotency)", () => {
  it("missing state file → empty state", () => {
    const dir = mkdtempSync(join(tmpdir(), "buyer-"));
    try {
      expect(loadBuyerState(join(dir, "nope.json"))).toEqual({});
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("roundtrips created ids; buyerPhaseDone marks completed phases", () => {
    const dir = mkdtempSync(join(tmpdir(), "buyer-"));
    const p = join(dir, "state.json");
    try {
      const s: BuyerState = { project_id: "project:1", demand_id: "demand:2", phases_done: ["project", "demand"] };
      saveBuyerState(p, s);
      const back = loadBuyerState(p);
      expect(back.project_id).toBe("project:1");
      expect(back.demand_id).toBe("demand:2");
      expect(buyerPhaseDone(back, "project")).toBe(true);
      expect(buyerPhaseDone(back, "demand")).toBe(true);
      expect(buyerPhaseDone(back, "publish")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("default path lands in the 209 evidence dir", () => {
    expect(defaultBuyerStatePath()).toContain("209-gec-buyer-route");
    expect(defaultBuyerStatePath()).toContain("buyer-state.json");
  });
});

describe("parsePhase (buyer phases, dispatch only)", () => {
  it("accepts project|demand|publish|lifecycle", () => {
    expect(parsePhase(["--phase=project"])).toBe("project");
    expect(parsePhase(["--phase=demand"])).toBe("demand");
    expect(parsePhase(["--phase=publish"])).toBe("publish");
    expect(parsePhase(["--phase=lifecycle"])).toBe("lifecycle");
  });
  it("keeps the 205 phases", () => {
    expect(parsePhase(["--phase=tools"])).toBe("tools");
    expect(parsePhase(["--phase=verify"])).toBe("verify");
  });
  it("rejects unknown phases", () => {
    expect(() => parsePhase(["--phase=explode"])).toThrow(/usage/);
    expect(() => parsePhase([])).toThrow(/usage/);
  });
});
