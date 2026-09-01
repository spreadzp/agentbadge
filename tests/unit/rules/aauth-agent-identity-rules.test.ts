import { describe, it, expect } from "vitest";
import { AB135, AB136, AB137, AB138, AB139, AB140 } from "../../../src/agent-readiness/rules/AB135";
import type { EvaluateInput } from "../../../src/agent-readiness/rules/AB128";

describe("AAuth & Agent Identity rules", () => {
  it("AB-135: AAuth metadata endpoint — VERIFIED", () => {
    const input: EvaluateInput = {
      aauth: { data: { aauthFound: true } },
    };
    const result = AB135.evaluate(input);
    expect(result.status).toBe("VERIFIED");
  });

  it("AB-135: MISSING when no aauth.json", () => {
    const input: EvaluateInput = {
      aauth: { data: { aauthFound: false } },
    };
    const result = AB135.evaluate(input);
    expect(result.status).toBe("GAP");
  });

  it("AB-135: MISSING when no aauth source", () => {
    const result = AB135.evaluate({});
    expect(result.status).toBe("GAP");
  });

  it("AB-136: Agent Authorization Grant supported — VERIFIED", () => {
    const input: EvaluateInput = {
      aauth: { data: { agentGrantSupported: true } },
    };
    const result = AB136.evaluate(input);
    expect(result.status).toBe("VERIFIED");
  });

  it("AB-136: MISSING when grant not supported", () => {
    const input: EvaluateInput = {
      aauth: { data: { agentGrantSupported: false } },
    };
    const result = AB136.evaluate(input);
    expect(result.status).toBe("GAP");
  });

  it("AB-137: AAuth scope descriptions (optional) — VERIFIED", () => {
    const input: EvaluateInput = {
      aauth: { data: { scopeDescriptions: [{ scope: "read", description: "Read" }] } },
    };
    const result = AB137.evaluate(input);
    expect(result.status).toBe("VERIFIED");
  });

  it("AB-137: MISSING when no scope descriptions", () => {
    const input: EvaluateInput = {
      aauth: { data: { scopeDescriptions: [] } },
    };
    const result = AB137.evaluate(input);
    expect(result.status).toBe("GAP");
  });

  it("AB-138: DPoP supported (optional) — VERIFIED", () => {
    const input: EvaluateInput = {
      credential_security: { data: { dpopSupported: true } },
    };
    const result = AB138.evaluate(input);
    expect(result.status).toBe("VERIFIED");
  });

  it("AB-138: MISSING when DPoP not supported", () => {
    const input: EvaluateInput = {
      credential_security: { data: { dpopSupported: false } },
    };
    const result = AB138.evaluate(input);
    expect(result.status).toBe("GAP");
  });

  it("AB-139: mTLS-bound tokens (optional) — VERIFIED", () => {
    const input: EvaluateInput = {
      credential_security: { data: { mtlsBoundTokens: true } },
    };
    const result = AB139.evaluate(input);
    expect(result.status).toBe("VERIFIED");
  });

  it("AB-139: MISSING when no mTLS binding", () => {
    const input: EvaluateInput = {
      credential_security: { data: { mtlsBoundTokens: false } },
    };
    const result = AB139.evaluate(input);
    expect(result.status).toBe("GAP");
  });

  it("AB-140: Auth.md documents agent auth flow — VERIFIED", () => {
    const input: EvaluateInput = {
      auth_md: { body: "# Agent Authentication\n\nAgents must use OAuth2 with session-scoped tokens. See /aauth.json for scopes." },
    } as unknown as EvaluateInput;
    const result = AB140.evaluate(input);
    expect(result.status).toBe("VERIFIED");
  });

  it("AB-140: MISSING when auth.md has no agent auth docs", () => {
    const input: EvaluateInput = {
      auth_md: { body: "# Auth\n\nUse API key in header." },
    } as unknown as EvaluateInput;
    const result = AB140.evaluate(input);
    expect(result.status).toBe("GAP");
  });

  it("AB-140: MISSING when no auth_md source", () => {
    const result = AB140.evaluate({});
    expect(result.status).toBe("GAP");
  });

  it("AB-135: rule metadata correct", () => {
    expect(AB135.rule_id).toBe("AB-135");
    expect(AB135.severity).toBe("medium");
    expect(AB135.counted_in_score).toBe(true);
    expect(AB135.category).toBe("bot_auth");
  });

  it("AB-136: rule metadata correct", () => {
    expect(AB136.rule_id).toBe("AB-136");
    expect(AB136.severity).toBe("medium");
    expect(AB136.counted_in_score).toBe(true);
  });

  it("AB-137: rule metadata correct (optional)", () => {
    expect(AB137.rule_id).toBe("AB-137");
    expect(AB137.counted_in_score).toBe(false);
  });

  it("AB-138: rule metadata correct (optional)", () => {
    expect(AB138.rule_id).toBe("AB-138");
    expect(AB138.counted_in_score).toBe(false);
  });

  it("AB-139: rule metadata correct (optional)", () => {
    expect(AB139.rule_id).toBe("AB-139");
    expect(AB139.counted_in_score).toBe(false);
  });

  it("AB-140: rule metadata correct", () => {
    expect(AB140.rule_id).toBe("AB-140");
    expect(AB140.severity).toBe("low");
    expect(AB140.counted_in_score).toBe(true);
    expect(AB140.category).toBe("documentation");
  });
});
