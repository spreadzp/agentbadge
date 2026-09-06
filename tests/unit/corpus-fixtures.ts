/**
 * SLICE-103-2: Test fixtures for corpus extractor and store tests.
 */

import type { RuleEngineResult } from "../../src/agent-readiness/rule-engine/rule-engine";
import type { ScoreResult } from "../../src/agent-readiness/scoring/scoring-types";
import type { GapSummary } from "../../src/agent-readiness/gap-engine/gap-engine";

export function makeMockRuleEngineResult(): RuleEngineResult {
  return {
    assertions: [
      {
        rule_id: "AB-001",
        rule_version: "1.0.0",
        status: "VERIFIED",
        evidence: [],
        confidence: 1.0,
        timestamp: "2025-09-06T12:00:00Z",
        source_url: null,
        reason: "robots.txt found",
        category: "discovery",
        name: "Robots.txt",
        claim: "Service has robots.txt",
        verified_at: "2025-09-06T12:00:00Z",
        review_level: "automatic",
      },
      {
        rule_id: "AB-002",
        rule_version: "1.0.0",
        status: "GAP",
        evidence: [],
        confidence: 0,
        timestamp: "2025-09-06T12:00:00Z",
        source_url: null,
        reason: "No llms.txt found",
        category: "documentation",
        name: "LLMs.txt",
        claim: "Service has llms.txt",
        verified_at: "2025-09-06T12:00:00Z",
        review_level: "automatic",
      },
      {
        rule_id: "AB-003",
        rule_version: "1.0.0",
        status: "INFERRED",
        evidence: [],
        confidence: 0.7,
        timestamp: "2025-09-06T12:00:00Z",
        source_url: null,
        reason: "OpenAPI spec inferred from patterns",
        category: "openapi",
        name: "OpenAPI Spec",
        claim: "Service has OpenAPI spec",
        verified_at: "2025-09-06T12:00:00Z",
        review_level: "automatic",
      },
    ],
    rulesetVersion: "agent-readiness@1.2.0",
    scannedAt: "2025-09-06T12:00:00Z",
    totalRules: 3,
    applicableRules: 3,
  };
}

export function makeMockScoreResult(): ScoreResult {
  return {
    total: {
      rawScore: 65,
      score: 72,
      grade: "B",
      floorTriggered: false,
      floorReason: null,
    },
    categories: {
      discovery: {
        category: "discovery",
        weight: 15,
        rawScore: 80,
        score: 80,
        ruleCount: 1,
        applicableCount: 1,
        floorTriggered: false,
      },
      documentation: {
        category: "documentation",
        weight: 15,
        rawScore: 50,
        score: 50,
        ruleCount: 1,
        applicableCount: 1,
        floorTriggered: false,
      },
      openapi: {
        category: "openapi",
        weight: 10,
        rawScore: 70,
        score: 70,
        ruleCount: 1,
        applicableCount: 1,
        floorTriggered: false,
      },
    } as unknown as ScoreResult["categories"],
    pillars: {
      discovery: {
        pillar: "discovery",
        weight: 20,
        rawScore: 80,
        score: 80,
        categoryCount: 1,
        applicableCount: 1,
        floorTriggered: false,
      },
      understandability: {
        pillar: "understandability",
        weight: 25,
        rawScore: 60,
        score: 60,
        categoryCount: 1,
        applicableCount: 1,
        floorTriggered: false,
      },
    } as unknown as ScoreResult["pillars"],
    delta: null,
    config: {
      categoryWeights: {} as unknown as ScoreResult["config"]["categoryWeights"],
      statusContributions: { VERIFIED: 1, INFERRED: 0.6, CONFLICT: 0, GAP: 0, NOT_APPLICABLE: 0 },
      floorCap: 40,
      floorCategories: [],
      floorTriggerSeverity: [],
      scoringModel: "v2-pillars",
      pillarWeights: {} as unknown as ScoreResult["config"]["pillarWeights"],
    },
    computedAt: "2025-09-06T12:00:00Z",
  };
}

export function makeMockGapSummary(): GapSummary {
  return {
    total: 1,
    by_priority: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0 },
    by_type: { documentation: 1, semantic: 0, capability: 0, evidence: 0 },
  };
}
