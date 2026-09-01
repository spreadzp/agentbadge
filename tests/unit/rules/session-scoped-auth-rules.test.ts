import { describe, it, expect } from "vitest";
import { AB128, AB129, AB130, AB131, AB132, AB133, AB134 } from "../../../src/agent-readiness/rules/AB128";
import type { EvaluateInput } from "../../../src/agent-readiness/rules/AB128";

describe("Session-scoped auth rules", () => {
  it("AB-128: OAuth2 preferred over static API keys — VERIFIED", () => {
    const input: EvaluateInput = {
      credential_security: { data: { usesOAuth2: true, usesStaticApiKey: false } },
    };
    const result = AB128.evaluate(input);
    expect(result.status).toBe("VERIFIED");
  });

  it("AB-128: FAILS when only static API key", () => {
    const input: EvaluateInput = {
      credential_security: { data: { usesOAuth2: false, usesStaticApiKey: true } },
    };
    const result = AB128.evaluate(input);
    expect(result.status).toBe("GAP");
  });

  it("AB-128: FAILS when no credential_security source", () => {
    const result = AB128.evaluate({});
    expect(result.status).toBe("GAP");
  });

  it("AB-129: Credentials via headers — VERIFIED", () => {
    const input: EvaluateInput = {
      credential_security: { data: { credentialsInHeader: true, credentialsInQuery: false } },
    };
    const result = AB129.evaluate(input);
    expect(result.status).toBe("VERIFIED");
  });

  it("AB-129: FAILS when credentials in query params", () => {
    const input: EvaluateInput = {
      credential_security: { data: { credentialsInHeader: false, credentialsInQuery: true } },
    };
    const result = AB129.evaluate(input);
    expect(result.status).toBe("GAP");
  });

  it("AB-130: OAuth scopes defined — VERIFIED", () => {
    const input: EvaluateInput = {
      credential_security: { data: { scopesDefined: true } },
    };
    const result = AB130.evaluate(input);
    expect(result.status).toBe("VERIFIED");
  });

  it("AB-130: FAILS when scopes not defined", () => {
    const input: EvaluateInput = {
      credential_security: { data: { scopesDefined: false } },
    };
    const result = AB130.evaluate(input);
    expect(result.status).toBe("GAP");
  });

  it("AB-131: Token revocation endpoint — VERIFIED", () => {
    const input: EvaluateInput = {
      credential_security: { data: { revocationSupported: true } },
    };
    const result = AB131.evaluate(input);
    expect(result.status).toBe("VERIFIED");
  });

  it("AB-131: FAILS when no revocation endpoint", () => {
    const input: EvaluateInput = {
      credential_security: { data: { revocationSupported: false } },
    };
    const result = AB131.evaluate(input);
    expect(result.status).toBe("GAP");
  });

  it("AB-132: Token introspection (optional) — VERIFIED", () => {
    const input: EvaluateInput = {
      credential_security: { data: { introspectionSupported: true } },
    };
    const result = AB132.evaluate(input);
    expect(result.status).toBe("VERIFIED");
  });

  it("AB-132: MISSING when no introspection", () => {
    const input: EvaluateInput = {
      credential_security: { data: { introspectionSupported: false } },
    };
    const result = AB132.evaluate(input);
    expect(result.status).toBe("GAP");
  });

  it("AB-133: Private key JWT (optional) — VERIFIED", () => {
    const input: EvaluateInput = {
      credential_security: { data: { privateKeyJwtSupported: true } },
    };
    const result = AB133.evaluate(input);
    expect(result.status).toBe("VERIFIED");
  });

  it("AB-134: Token Exchange RFC 8693 (optional) — VERIFIED", () => {
    const input: EvaluateInput = {
      credential_security: { data: { tokenExchangeSupported: true } },
    };
    const result = AB134.evaluate(input);
    expect(result.status).toBe("VERIFIED");
  });

  it("AB-128: rule metadata correct", () => {
    expect(AB128.rule_id).toBe("AB-128");
    expect(AB128.severity).toBe("high");
    expect(AB128.counted_in_score).toBe(true);
    expect(AB128.category).toBe("bot_auth");
  });

  it("AB-129: rule metadata correct", () => {
    expect(AB129.rule_id).toBe("AB-129");
    expect(AB129.severity).toBe("high");
    expect(AB129.counted_in_score).toBe(true);
  });

  it("AB-130: rule metadata correct", () => {
    expect(AB130.rule_id).toBe("AB-130");
    expect(AB130.severity).toBe("medium");
    expect(AB130.counted_in_score).toBe(true);
  });

  it("AB-131: rule metadata correct", () => {
    expect(AB131.rule_id).toBe("AB-131");
    expect(AB131.severity).toBe("medium");
    expect(AB131.counted_in_score).toBe(true);
  });

  it("AB-132: rule metadata correct (optional)", () => {
    expect(AB132.rule_id).toBe("AB-132");
    expect(AB132.counted_in_score).toBe(false);
  });

  it("AB-133: rule metadata correct (optional)", () => {
    expect(AB133.rule_id).toBe("AB-133");
    expect(AB133.counted_in_score).toBe(false);
  });

  it("AB-134: rule metadata correct (optional)", () => {
    expect(AB134.rule_id).toBe("AB-134");
    expect(AB134.counted_in_score).toBe(false);
  });
});
