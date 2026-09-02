import { describe, it, expect } from "vitest";
import { StatusDeterminator } from "../../../src/agent-readiness/rule-engine/status-determinator";
import { ConfidenceComputer } from "../../../src/agent-readiness/rule-engine/confidence";
import { AssertionBuilder } from "../../../src/agent-readiness/rule-engine/assertion-builder";
import { statusEnum, normalizeStatus, statusInputSchema } from "../../../src/agent-readiness/shared.schema";
import { DEFAULT_STATUS_CONTRIBUTIONS } from "../../../src/agent-readiness/scoring/scoring-types";
import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";
import type { Evidence } from "../../../src/agent-readiness/rule-engine/evidence.types";

const dummyRule: AgentReadinessRule = {
  rule_id: "AB-TEST",
  version: "1.0.0",
  name: "Test rule",
  category: "discovery",
  severity: "low",
  check: {
    type: "http_fetch",
    target: "https://example.com/robots.txt",
  },
  fix: { eligible: false, type: "none" },
} as any;

describe("SLICE-94-2: GAP Status Rename + Compat Shim", () => {
  describe("normalizeStatus", () => {
    it("normalizes MISSING → GAP", () => {
      expect(normalizeStatus("MISSING")).toBe("GAP");
    });

    it("passes through GAP unchanged", () => {
      expect(normalizeStatus("GAP")).toBe("GAP");
    });

    it("passes through other statuses unchanged", () => {
      expect(normalizeStatus("VERIFIED")).toBe("VERIFIED");
      expect(normalizeStatus("INFERRED")).toBe("INFERRED");
      expect(normalizeStatus("CONFLICT")).toBe("CONFLICT");
      expect(normalizeStatus("NOT_APPLICABLE")).toBe("NOT_APPLICABLE");
    });
  });

  describe("statusEnum", () => {
    it("accepts GAP", () => {
      expect(statusEnum.safeParse("GAP").success).toBe(true);
    });

    it("accepts MISSING via statusInputSchema (legacy compat)", () => {
      const result = statusInputSchema.safeParse("MISSING");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe("GAP");
      }
    });

    it("statusEnum rejects MISSING (GAP is canonical)", () => {
      expect(statusEnum.safeParse("MISSING").success).toBe(false);
    });

    it("rejects garbage", () => {
      expect(statusEnum.safeParse("GARBAGE").success).toBe(false);
    });

    it("does not include MISSING in the enum values (GAP is canonical)", () => {
      const enumValues = statusEnum.options;
      expect(enumValues).toContain("GAP");
      expect(enumValues).not.toContain("MISSING");
    });
  });

  describe("StatusDeterminator", () => {
    it("emits GAP when no evidence found", () => {
      const result = StatusDeterminator.determine({
        rule: dummyRule,
        evidence: null,
        isApplicable: true,
      });
      expect(result.status).toBe("GAP");
      expect(result.reason).toContain("No evidence found");
    });

    it("emits GAP when evidence does not confirm or contradict", () => {
      const irrelevantEvidence: Evidence[] = [
        {
          type: "http",
          url: "https://example.com/other",
          status: 200,
          headers: {},
          content_hash: "abc",
          content_type: "text/html",
          resolved_ip: null,
        },
      ];
      const result = StatusDeterminator.determine({
        rule: dummyRule,
        evidence: irrelevantEvidence,
        isApplicable: true,
      });
      expect(result.status).toBe("GAP");
      expect(result.reason).toContain("does not confirm");
    });

    it("does NOT emit MISSING in any path", () => {
      const noEvidence = StatusDeterminator.determine({
        rule: dummyRule,
        evidence: null,
        isApplicable: true,
      });
      expect(noEvidence.status).not.toBe("MISSING");

      const irrelevantEvidence: Evidence[] = [
        {
          type: "http",
          url: "https://example.com/other",
          status: 200,
          headers: {},
          content_hash: "abc",
          content_type: "text/html",
          resolved_ip: null,
        },
      ];
      const unconfirming = StatusDeterminator.determine({
        rule: dummyRule,
        evidence: irrelevantEvidence,
        isApplicable: true,
      });
      expect(unconfirming.status).not.toBe("MISSING");
    });
  });

  describe("ConfidenceComputer", () => {
    it("returns 0.0 for GAP status", () => {
      const result = ConfidenceComputer.compute({
        rule: dummyRule,
        evidence: [],
        status: "GAP",
      });
      expect(result).toBe(0.0);
    });

    it("also handles MISSING defensively (returns 0.0)", () => {
      const result = ConfidenceComputer.compute({
        rule: dummyRule,
        evidence: [],
        status: "MISSING" as any,
      });
      expect(result).toBe(0.0);
    });
  });

  describe("AssertionBuilder.deserialize", () => {
    it("normalizes MISSING → GAP on deserialize", () => {
      const legacyJson = JSON.stringify({
        rule_id: "AB-001",
        rule_version: "1.0.0",
        status: "MISSING",
        evidence: [],
        confidence: 0,
        timestamp: "2026-01-01T00:00:00Z",
        source_url: null,
        reason: "No evidence found",
        category: "discovery",
        name: "Test",
      });
      const assertion = AssertionBuilder.deserialize(legacyJson);
      expect(assertion.status).toBe("GAP");
    });

    it("passes through GAP on deserialize", () => {
      const json = JSON.stringify({
        rule_id: "AB-001",
        rule_version: "1.0.0",
        status: "GAP",
        evidence: [],
        confidence: 0,
        timestamp: "2026-01-01T00:00:00Z",
        source_url: null,
        reason: "No evidence found",
        category: "discovery",
        name: "Test",
      });
      const assertion = AssertionBuilder.deserialize(json);
      expect(assertion.status).toBe("GAP");
    });
  });

  describe("AssertionBuilder.serialize — no MISSING in output", () => {
    it("never emits MISSING string in serialized output", () => {
      const assertion = AssertionBuilder.build({
        rule: dummyRule,
        evidence: [],
        status: "GAP",
        confidence: 0,
        reason: "No evidence found",
      });
      const serialized = AssertionBuilder.serialize(assertion);
      expect(serialized).not.toContain("MISSING");
      expect(serialized).toContain("GAP");
    });
  });

  describe("Scoring — DEFAULT_STATUS_CONTRIBUTIONS", () => {
    it("has GAP key with contribution 0", () => {
      expect(DEFAULT_STATUS_CONTRIBUTIONS).toHaveProperty("GAP");
      expect(DEFAULT_STATUS_CONTRIBUTIONS.GAP).toBe(0.0);
    });

    it("does not have MISSING as a key (renamed to GAP)", () => {
      expect(DEFAULT_STATUS_CONTRIBUTIONS).not.toHaveProperty("MISSING");
    });
  });
});
