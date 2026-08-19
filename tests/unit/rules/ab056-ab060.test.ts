import { describe, it, expect } from "vitest";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { AB056 } from "../../../src/agent-readiness/rules/AB056";
import { AB057 } from "../../../src/agent-readiness/rules/AB057";
import { AB058 } from "../../../src/agent-readiness/rules/AB058";
import { AB059 } from "../../../src/agent-readiness/rules/AB059";
import { AB060 } from "../../../src/agent-readiness/rules/AB060";

describe("SLICE-48-21: AB-056..AB-060 optional discovery rules", () => {
  it("AB-056: WebFinger endpoint available", () => {
    expect(AB056.rule_id).toBe("AB-056");
    expect(AB056.category).toBe("identity");
    expect(AB056.counted_in_score).toBe(false);
  });

  it("AB-057: DID document available", () => {
    expect(AB057.rule_id).toBe("AB-057");
    expect(AB057.category).toBe("identity");
    expect(AB057.counted_in_score).toBe(false);
  });

  it("AB-058: Bot auth signatures directory found", () => {
    expect(AB058.rule_id).toBe("AB-058");
    expect(AB058.category).toBe("bot_auth");
    expect(AB058.counted_in_score).toBe(false);
  });

  it("AB-059: Bot auth members valid", () => {
    expect(AB059.rule_id).toBe("AB-059");
    expect(AB059.category).toBe("bot_auth");
    expect(AB059.counted_in_score).toBe(false);
  });

  it("AB-060: Bot auth public keys reachable", () => {
    expect(AB060.rule_id).toBe("AB-060");
    expect(AB060.category).toBe("bot_auth");
    expect(AB060.counted_in_score).toBe(false);
  });

  it("all 5 rules registered in ruleset", () => {
    const ids = AGENT_READINESS_RULESET.rules.map((r) => r.rule_id);
    expect(ids).toContain("AB-056");
    expect(ids).toContain("AB-057");
    expect(ids).toContain("AB-058");
    expect(ids).toContain("AB-059");
    expect(ids).toContain("AB-060");
    expect(AGENT_READINESS_RULESET.rules).toHaveLength(82);
  });
});
