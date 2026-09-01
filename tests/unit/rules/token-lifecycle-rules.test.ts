import { describe, it, expect } from "vitest";
import { AB141, AB142, AB143, AB144, AB145 } from "../../../src/agent-readiness/rules/AB141";
import type { EvaluateInput } from "../../../src/agent-readiness/rules/AB128";

describe("Token lifecycle & credential vault rules", () => {
  it("AB-141: Short-lived access tokens (expires_in present) — VERIFIED", () => {
    const input = {
      auth_probe: { tokenExpiresIn: 3600 },
    } as unknown as EvaluateInput;
    const result = AB141.evaluate(input);
    expect(result.status).toBe("VERIFIED");
  });

  it("AB-141: MISSING when no expires_in", () => {
    const input = {
      auth_probe: { tokenExpiresIn: undefined },
    } as unknown as EvaluateInput;
    const result = AB141.evaluate(input);
    expect(result.status).toBe("GAP");
  });

  it("AB-141: MISSING when no auth_probe source", () => {
    const result = AB141.evaluate({});
    expect(result.status).toBe("GAP");
  });

  it("AB-142: Refresh token rotation (optional) — VERIFIED", () => {
    const input = {
      oauth_authorization_server: {
        body: JSON.stringify({ grant_types_supported: ["client_credentials", "refresh_token"] }),
      },
    } as unknown as EvaluateInput;
    const result = AB142.evaluate(input);
    expect(result.status).toBe("VERIFIED");
  });

  it("AB-142: MISSING when no refresh_token grant", () => {
    const input = {
      oauth_authorization_server: {
        body: JSON.stringify({ grant_types_supported: ["client_credentials"] }),
      },
    } as unknown as EvaluateInput;
    const result = AB142.evaluate(input);
    expect(result.status).toBe("GAP");
  });

  it("AB-142: MISSING when invalid JSON body", () => {
    const input = {
      oauth_authorization_server: { body: "not json" },
    } as unknown as EvaluateInput;
    const result = AB142.evaluate(input);
    expect(result.status).toBe("GAP");
  });

  it("AB-143: Token revocation endpoint reachable — VERIFIED", () => {
    const input: EvaluateInput = {
      credential_security: { data: { revocationSupported: true } },
    };
    const result = AB143.evaluate(input);
    expect(result.status).toBe("VERIFIED");
  });

  it("AB-143: MISSING when no revocation", () => {
    const input: EvaluateInput = {
      credential_security: { data: { revocationSupported: false } },
    };
    const result = AB143.evaluate(input);
    expect(result.status).toBe("GAP");
  });

  it("AB-144: Auth.md documents credential vault — VERIFIED", () => {
    const input = {
      auth_md: { body: "# Agent Auth\n\nUse credential vault with session-scoped tokens. Rotate keys regularly." },
    } as unknown as EvaluateInput;
    const result = AB144.evaluate(input);
    expect(result.status).toBe("VERIFIED");
  });

  it("AB-144: MISSING when auth.md has no vault docs", () => {
    const input = {
      auth_md: { body: "# Auth\n\nUse API key." },
    } as unknown as EvaluateInput;
    const result = AB144.evaluate(input);
    expect(result.status).toBe("GAP");
  });

  it("AB-144: MISSING when no auth_md source", () => {
    const result = AB144.evaluate({});
    expect(result.status).toBe("GAP");
  });

  it("AB-145: No static API keys in OpenAPI security — VERIFIED", () => {
    const input: EvaluateInput = {
      credential_security: { data: { usesStaticApiKey: false } },
    };
    const result = AB145.evaluate(input);
    expect(result.status).toBe("VERIFIED");
  });

  it("AB-145: FAILS when static API key found", () => {
    const input: EvaluateInput = {
      credential_security: { data: { usesStaticApiKey: true } },
    };
    const result = AB145.evaluate(input);
    expect(result.status).toBe("GAP");
  });

  it("AB-141: rule metadata correct", () => {
    expect(AB141.rule_id).toBe("AB-141");
    expect(AB141.severity).toBe("medium");
    expect(AB141.counted_in_score).toBe(true);
  });

  it("AB-142: rule metadata correct (optional)", () => {
    expect(AB142.rule_id).toBe("AB-142");
    expect(AB142.counted_in_score).toBe(false);
  });

  it("AB-143: rule metadata correct", () => {
    expect(AB143.rule_id).toBe("AB-143");
    expect(AB143.severity).toBe("medium");
    expect(AB143.counted_in_score).toBe(true);
  });

  it("AB-144: rule metadata correct (optional)", () => {
    expect(AB144.rule_id).toBe("AB-144");
    expect(AB144.counted_in_score).toBe(false);
    expect(AB144.category).toBe("documentation");
  });

  it("AB-145: rule metadata correct", () => {
    expect(AB145.rule_id).toBe("AB-145");
    expect(AB145.severity).toBe("high");
    expect(AB145.counted_in_score).toBe(true);
  });
});
