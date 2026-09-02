import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runScoringEngine } from "../../../src/agent-readiness/scoring/scoring-engine";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";
import { DEFAULT_CATEGORY_WEIGHTS } from "../../../src/agent-readiness/scoring/scoring-types";

/**
 * SLICE-93-11: Golden-score regression test
 *
 * Hand-computed expected values from the Scoring V2 formula:
 *
 * Status contributions: VERIFIED=1.0, INFERRED=0.6, CONFLICT=0.0, MISSING=0.0
 * NOT_APPLICABLE excluded from denominator.
 *
 * Category score = (sum of contributions / applicable count) * 100, rounded to 2dp.
 * Pillar score = weighted avg of applicable category scores, score = Math.round(rawScore).
 * Total (v2) = sum(pillar.score * pillarWeight / 100), rounded to 2dp.
 * Floor: triggered when MISSING/CONFLICT with severity="high" in discovery/documentation.
 *        Cap = 40. If rawTotal > cap, score = cap, grade = "F".
 *
 * ── Category scores (DEFAULT_CATEGORY_WEIGHTS) ──
 * discovery      (w15): (1.0+0.0+1.0)/3 * 100 = 66.67  floorTriggered=true
 * machine_readable(w10): (1.0+0.6)/2 * 100 = 80
 * openapi        (w10): 1.0/1 * 100 = 100
 * documentation  (w15): (1.0+0.6)/2 * 100 = 80  (NOT_APPLICABLE excluded)
 * actionability  (w10): (1.0+0.0)/2 * 100 = 50
 * accessibility  (w4):  0.6/1 * 100 = 60
 * bot_auth       (w1):  (1.0+0.0)/2 * 100 = 50
 * payments       (w10): 1.0/1 * 100 = 100
 * identity       (w2):  0.6/1 * 100 = 60
 * verification   (w5):  (1.0+0.6)/2 * 100 = 80
 * infrastructure (w1):  0.0/1 * 100 = 0
 * active_probing (w5):  1.0/1 * 100 = 100
 *
 * ── Pillar scores ──
 * Discovery (w20):
 *   weightSum = 15+10+10 = 35
 *   weightedSum = 66.67*15 + 80*10 + 100*10 = 1000.05+800+1000 = 2800.05
 *   rawScore = 2800.05/35 = 80.00 → score = 80, floorTriggered=true
 *
 * Understandability (w25):
 *   weightSum = 15+10+4 = 29
 *   weightedSum = 80*15 + 50*10 + 60*4 = 1200+500+240 = 1940
 *   rawScore = 1940/29 = 66.90 → score = 67, floorTriggered=false
 *
 * Executability (w30):
 *   weightSum = 1+10+2 = 13
 *   weightedSum = 50*1 + 100*10 + 60*2 = 50+1000+120 = 1170
 *   rawScore = 1170/13 = 90.00 → score = 90, floorTriggered=false
 *
 * Verifiability (w25):
 *   weightSum = 5+1+5 = 11
 *   weightedSum = 80*5 + 0*1 + 100*5 = 400+0+500 = 900
 *   rawScore = 900/11 = 81.82 → score = 82, floorTriggered=false
 *
 * ── Total (v2) ──
 * rawScore = 80*20/100 + 67*25/100 + 90*30/100 + 82*25/100
 *          = 16 + 16.75 + 27 + 20.5 = 80.25
 * Floor triggered (AB-002: MISSING, high, discovery) → cap = 40
 * score = min(80.25, 40) = 40, grade = "F"
 */

const fixturePath = join(__dirname, "../../fixtures/scoring/golden-assertions.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));
const assertions = fixture.assertions as Assertion[];

const manifest = {
  name: "agent-readiness",
  version: "1.4.0",
  categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
  scoring: { pillars: { scoringModel: "v2-pillars" as const } },
};

describe("SLICE-93-11: Golden-score regression", () => {
  const result = runScoringEngine({ assertions, rulesetManifest: manifest });

  it("produces 12 category scores", () => {
    expect(Object.keys(result.categories)).toHaveLength(12);
  });

  // ── Category scores ──
  it("discovery category: score=66.67, floorTriggered=true", () => {
    const cs = result.categories.discovery;
    expect(cs.score).toBe(66.67);
    expect(cs.weight).toBe(15);
    expect(cs.applicableCount).toBe(3);
    expect(cs.floorTriggered).toBe(true);
  });

  it("machine_readable category: score=80", () => {
    expect(result.categories.machine_readable.score).toBe(80);
    expect(result.categories.machine_readable.applicableCount).toBe(2);
  });

  it("openapi category: score=100", () => {
    expect(result.categories.openapi.score).toBe(100);
    expect(result.categories.openapi.applicableCount).toBe(1);
  });

  it("documentation category: score=80 (NOT_APPLICABLE excluded)", () => {
    expect(result.categories.documentation.score).toBe(80);
    expect(result.categories.documentation.applicableCount).toBe(2);
    expect(result.categories.documentation.ruleCount).toBe(3);
  });

  it("actionability category: score=50 (CONFLICT=0)", () => {
    expect(result.categories.actionability.score).toBe(50);
    expect(result.categories.actionability.applicableCount).toBe(2);
  });

  it("accessibility category: score=60 (INFERRED=0.6)", () => {
    expect(result.categories.accessibility.score).toBe(60);
  });

  it("bot_auth category: score=50", () => {
    expect(result.categories.bot_auth.score).toBe(50);
  });

  it("payments category: score=100", () => {
    expect(result.categories.payments.score).toBe(100);
  });

  it("identity category: score=60", () => {
    expect(result.categories.identity.score).toBe(60);
  });

  it("verification category: score=80", () => {
    expect(result.categories.verification.score).toBe(80);
  });

  it("infrastructure category: score=0 (MISSING=0)", () => {
    expect(result.categories.infrastructure.score).toBe(0);
  });

  it("active_probing category: score=100", () => {
    expect(result.categories.active_probing.score).toBe(100);
  });

  // ── Pillar scores ──
  it("discovery pillar: score=80, weight=20, floorTriggered=true", () => {
    const ps = result.pillars.discovery;
    expect(ps.score).toBe(80);
    expect(ps.weight).toBe(20);
    expect(ps.floorTriggered).toBe(true);
    expect(ps.categoryCount).toBe(3);
    expect(ps.applicableCount).toBe(3);
  });

  it("understandability pillar: score=67, weight=25", () => {
    const ps = result.pillars.understandability;
    expect(ps.score).toBe(67);
    expect(ps.weight).toBe(25);
    expect(ps.floorTriggered).toBe(false);
  });

  it("executability pillar: score=90, weight=30", () => {
    const ps = result.pillars.executability;
    expect(ps.score).toBe(90);
    expect(ps.weight).toBe(30);
    expect(ps.floorTriggered).toBe(false);
  });

  it("verifiability pillar: score=82, weight=25", () => {
    const ps = result.pillars.verifiability;
    expect(ps.score).toBe(82);
    expect(ps.weight).toBe(25);
    expect(ps.floorTriggered).toBe(false);
  });

  // ── Total score ──
  it("total rawScore=80.25", () => {
    expect(result.total.rawScore).toBe(80.25);
  });

  it("total score=40 (floor capped)", () => {
    expect(result.total.score).toBe(40);
  });

  it("total grade=F (floor cap)", () => {
    expect(result.total.grade).toBe("F");
  });

  it("total floorTriggered=true", () => {
    expect(result.total.floorTriggered).toBe(true);
  });

  it("total floorReason mentions AB-002", () => {
    expect(result.total.floorReason).toContain("AB-002");
  });

  // ── Scoring model ──
  it("uses v2-pillars scoring model", () => {
    expect(result.config.scoringModel).toBe("v2-pillars");
  });

  // ── Math consistency: total = Σ pillar.score * weight / 100 ──
  it("total rawScore equals sum of pillar score * weight / 100", () => {
    const computed =
      (result.pillars.discovery.score * 20) / 100 +
      (result.pillars.understandability.score * 25) / 100 +
      (result.pillars.executability.score * 30) / 100 +
      (result.pillars.verifiability.score * 25) / 100;
    expect(Math.round(computed * 100) / 100).toBe(result.total.rawScore);
  });
});
