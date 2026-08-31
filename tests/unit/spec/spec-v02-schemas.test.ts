import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import Ajv from "ajv/dist/2020.js";

const SCHEMAS_DIR = join(
  __dirname,
  "..",
  "..",
  "..",
  "docs",
  "EPICS",
  "32-agent-readiness-spec",
  "spec",
  "schemas",
);

const reportSchema = JSON.parse(
  readFileSync(join(SCHEMAS_DIR, "agentbadge-report.schema.json"), "utf-8"),
);
const ruleSchema = JSON.parse(
  readFileSync(join(SCHEMAS_DIR, "agentbadge-rule.schema.json"), "utf-8"),
);

const ajv = new Ajv({ strict: false, allErrors: true });

const validateReport = ajv.compile(reportSchema);
const validateRule = ajv.compile(ruleSchema);

const baseReport = {
  report_id: "01HGEJG1ARHE0X3X9P1WEKE7M1",
  schema_version: "0.1.0",
  ruleset: { name: "agent-readiness", version: "1.2.0" },
  scope: {
    agent_id: "https://api.example.com",
    agent_version: "1.0.0",
    endpoint_base_url: "https://api.example.com",
    timestamp: "2026-08-31T12:00:00Z",
  },
  scanned_at: "2026-08-31T12:00:01Z",
  previous_hash: null,
  source_state: [
    {
      url: "https://api.example.com/robots.txt",
      fetched_at: "2026-08-31T12:00:00Z",
      status_code: 200,
    },
  ],
  score: {
    total: 72,
    categories: {
      discovery: 80,
      documentation: 60,
      actionability: 70,
      machine_readable: 75,
      verification: 65,
    },
  },
  assertions: [
    {
      rule_id: "AB-001",
      rule_version: "1.0.0",
      category: "discovery",
      status: "VERIFIED",
      severity: "high",
      counted_in_score: true,
      confidence: 1.0,
      evidence: [{ source: "http_fetch", detail: "robots.txt found" }],
    },
  ],
  integrity: {
    algorithm: "sha256",
    canonicalization: "JCS-RFC8785",
    content_hash: "sha256:" + "a".repeat(64),
    signature: {
      algorithm: "ed25519",
      key_id: "key-001",
      value: "base64-signature",
    },
  },
};

const baseRule = {
  rule_id: "AB-001",
  version: "1.0.0",
  name: "robots.txt present",
  category: "discovery",
  severity: "high",
  counted_in_score: true,
  check: {
    type: "http_fetch",
    sources: ["robots.txt"],
  },
  fix: {
    eligible: true,
    type: "deterministic",
  },
};

describe("SLICE-93-1: spec v0.2 JSON schemas", () => {
  describe("agentbadge-report.schema.json", () => {
    it("validates a report with score.pillars", () => {
      const reportWithPillars = {
        ...baseReport,
        score: {
          ...baseReport.score,
          pillars: [
            {
              pillar: "discovery",
              weight: 20,
              rawScore: 78.5,
              score: 78,
              categoryCount: 8,
              applicableCount: 7,
              floorTriggered: false,
            },
            {
              pillar: "understandability",
              weight: 25,
              rawScore: 65.0,
              score: 65,
              categoryCount: 3,
              applicableCount: 3,
              floorTriggered: false,
            },
            {
              pillar: "executability",
              weight: 30,
              rawScore: 70.0,
              score: 70,
              categoryCount: 4,
              applicableCount: 4,
              floorTriggered: false,
            },
            {
              pillar: "verifiability",
              weight: 25,
              rawScore: 60.0,
              score: 60,
              categoryCount: 3,
              applicableCount: 2,
              floorTriggered: false,
            },
          ],
        },
      };
      const valid = validateReport(reportWithPillars);
      expect(valid, JSON.stringify(validateReport.errors, null, 2)).toBe(true);
    });

    it("validates a report without score.pillars (backward compatible)", () => {
      const valid = validateReport(baseReport);
      expect(valid, JSON.stringify(validateReport.errors, null, 2)).toBe(true);
    });

    it("rejects invalid pillar enum value in score.pillars", () => {
      const reportWithBadPillar = {
        ...baseReport,
        score: {
          ...baseReport.score,
          pillars: [
            {
              pillar: "nonexistent",
              weight: 20,
              rawScore: 78,
              score: 78,
              categoryCount: 8,
              applicableCount: 7,
              floorTriggered: false,
            },
          ],
        },
      };
      const valid = validateReport(reportWithBadPillar);
      expect(valid).toBe(false);
    });
  });

  describe("agentbadge-rule.schema.json", () => {
    it("validates a rule with pillar override", () => {
      const ruleWithPillar = {
        ...baseRule,
        pillar: "discovery",
      };
      const valid = validateRule(ruleWithPillar);
      expect(valid, JSON.stringify(validateRule.errors, null, 2)).toBe(true);
    });

    it("validates a rule without pillar (backward compatible)", () => {
      const valid = validateRule(baseRule);
      expect(valid, JSON.stringify(validateRule.errors, null, 2)).toBe(true);
    });

    it("rejects invalid pillar enum value in rule", () => {
      const ruleWithBadPillar = {
        ...baseRule,
        pillar: "nonexistent",
      };
      const valid = validateRule(ruleWithBadPillar);
      expect(valid).toBe(false);
    });
  });
});
