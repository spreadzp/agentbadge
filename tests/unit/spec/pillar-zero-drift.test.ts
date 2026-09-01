import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pillarEnum } from "../../../src/agent-readiness/shared.schema";
import { PILLARS, PILLAR_LABELS, PILLAR_QUESTIONS, CATEGORY_TO_PILLAR } from "../../../src/agent-readiness/scoring/pillar-map";

/**
 * SLICE-93-12: Zero-drift cross-check
 * Asserts pillar enums are identical across:
 * 1. shared.schema.ts (pillarEnum — the Zod schema)
 * 2. pillar-map.ts (PILLARS array — the runtime constant)
 * 3. JSON schema file (agentbadge-report.schema.json — the published spec)
 * 4. pillar-map.ts (CATEGORY_TO_PILLAR — every category maps to a valid pillar)
 */

const schemaPath = join(__dirname, "../../../docs/EPICS/32-agent-readiness-spec/spec/schemas/agentbadge-report.schema.json");
const rawSchema = JSON.parse(readFileSync(schemaPath, "utf-8"));

// Extract pillar enum from JSON schema: score.pillars.items.properties.pillar.enum
const schemaPillarEnum: string[] = rawSchema.properties.score.properties.pillars.items.properties.pillar.enum;

const zodPillarOptions = pillarEnum.options;
const pillarsArray = [...PILLARS];

describe("SLICE-93-12: Zero-drift — pillar enums match across all surfaces", () => {
  it("pillarEnum (Zod) options match PILLARS array (pillar-map.ts)", () => {
    expect(zodPillarOptions).toEqual(pillarsArray);
  });

  it("pillarEnum (Zod) options match JSON schema enum", () => {
    expect(zodPillarOptions).toEqual(schemaPillarEnum);
  });

  it("PILLARS array matches JSON schema enum", () => {
    expect(pillarsArray).toEqual(schemaPillarEnum);
  });

  it("all 4 pillars have labels", () => {
    for (const p of PILLARS) {
      expect(PILLAR_LABELS[p]).toBeDefined();
      expect(typeof PILLAR_LABELS[p]).toBe("string");
      expect(PILLAR_LABELS[p].length).toBeGreaterThan(0);
    }
  });

  it("all 4 pillars have questions", () => {
    for (const p of PILLARS) {
      expect(PILLAR_QUESTIONS[p]).toBeDefined();
      expect(typeof PILLAR_QUESTIONS[p]).toBe("string");
      expect(PILLAR_QUESTIONS[p].length).toBeGreaterThan(0);
    }
  });

  it("every category in CATEGORY_TO_PILLAR maps to a valid pillar", () => {
    for (const [, pillar] of Object.entries(CATEGORY_TO_PILLAR)) {
      expect(PILLARS).toContain(pillar);
      expect(zodPillarOptions).toContain(pillar);
    }
  });

  it("JSON schema enum has exactly 4 pillars", () => {
    expect(schemaPillarEnum).toHaveLength(4);
  });

  it("pillar order is consistent: discovery → understandability → executability → verifiability", () => {
    expect(zodPillarOptions).toEqual(["discovery", "understandability", "executability", "verifiability"]);
    expect(pillarsArray).toEqual(["discovery", "understandability", "executability", "verifiability"]);
    expect(schemaPillarEnum).toEqual(["discovery", "understandability", "executability", "verifiability"]);
  });
});
