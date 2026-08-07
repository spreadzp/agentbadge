import { describe, it, expect, beforeEach } from "vitest";
import { loadRegistry, clearRegistryCache } from "../../../src/server/registry/loader";
import {
  generateCapabilitiesMarkdown,
  generateTeamOverviewMarkdown,
  generateServicesMarkdown,
  generateAvailabilityMarkdown,
  generateContactMarkdown,
  generateMatchMarkdown,
} from "../../../src/server/registry/markdown";
import type { RegistryIndex } from "../../../src/server/registry/types";

describe("SLICE-46-13: Markdown Generation — unit tests", () => {
  let registry: RegistryIndex;

  beforeEach(async () => {
    clearRegistryCache();
    registry = await loadRegistry();
  });

  describe("generateCapabilitiesMarkdown()", () => {
    it("returns a non-empty string", () => {
      const md = generateCapabilitiesMarkdown(registry);
      expect(typeof md).toBe("string");
      expect(md.length).toBeGreaterThan(100);
    });

    it("contains main heading", () => {
      const md = generateCapabilitiesMarkdown(registry);
      expect(md).toContain("# AgentBadge Engineering Capabilities");
    });

    it("contains 'Who can help' section", () => {
      const md = generateCapabilitiesMarkdown(registry);
      expect(md).toContain("## Who can help");
    });

    it("contains 'Core capabilities' section", () => {
      const md = generateCapabilitiesMarkdown(registry);
      expect(md).toContain("## Core capabilities");
    });

    it("contains 'Missing capability' section", () => {
      const md = generateCapabilitiesMarkdown(registry);
      expect(md).toContain("## Missing capability?");
    });

    it("includes capability names", () => {
      const md = generateCapabilitiesMarkdown(registry);
      for (const cap of registry.capabilities) {
        if (cap.status !== "DEPRECATED" && cap.status !== "ARCHIVED") {
          expect(md).toContain(cap.name);
        }
      }
    });

    it("includes evidence section for capabilities with evidence", () => {
      const md = generateCapabilitiesMarkdown(registry);
      const capsWithEvidence = registry.capabilities.filter((c) => c.evidence.length > 0);
      if (capsWithEvidence.length > 0) {
        expect(md).toContain("**Evidence:**");
      }
    });

    it("includes status field", () => {
      const md = generateCapabilitiesMarkdown(registry);
      expect(md).toContain("**Status:**");
    });

    it("includes confidence field", () => {
      const md = generateCapabilitiesMarkdown(registry);
      expect(md).toContain("**Confidence:**");
    });

    it("includes skills field", () => {
      const md = generateCapabilitiesMarkdown(registry);
      expect(md).toContain("**Skills:**");
    });

    it("includes services field", () => {
      const md = generateCapabilitiesMarkdown(registry);
      expect(md).toContain("**Services:**");
    });

    it("includes people field", () => {
      const md = generateCapabilitiesMarkdown(registry);
      expect(md).toContain("**People:**");
    });
  });

  describe("generateTeamOverviewMarkdown()", () => {
    it("returns a non-empty string", () => {
      const md = generateTeamOverviewMarkdown(registry);
      expect(typeof md).toBe("string");
      expect(md.length).toBeGreaterThan(50);
    });

    it("contains team heading", () => {
      const md = generateTeamOverviewMarkdown(registry);
      expect(md).toContain("# AgentBadge Engineering Team");
    });

    it("contains active members count", () => {
      const md = generateTeamOverviewMarkdown(registry);
      expect(md).toContain("**Active members:**");
    });

    it("contains capabilities overview section", () => {
      const md = generateTeamOverviewMarkdown(registry);
      expect(md).toContain("## Capabilities overview");
    });

    it("contains detailed endpoints section", () => {
      const md = generateTeamOverviewMarkdown(registry);
      expect(md).toContain("## Detailed endpoints");
    });

    it("lists endpoint paths", () => {
      const md = generateTeamOverviewMarkdown(registry);
      expect(md).toContain("/agent-guide/team/capabilities");
      expect(md).toContain("/agent-guide/team/services");
    });
  });

  describe("generateServicesMarkdown()", () => {
    it("returns a non-empty string", () => {
      const md = generateServicesMarkdown(registry);
      expect(typeof md).toBe("string");
      expect(md.length).toBeGreaterThan(50);
    });

    it("contains services heading", () => {
      const md = generateServicesMarkdown(registry);
      expect(md).toContain("# AgentBadge Engineering Services");
    });

    it("includes service names", () => {
      const md = generateServicesMarkdown(registry);
      for (const svc of registry.services) {
        expect(md).toContain(svc.name);
      }
    });

    it("includes problem field", () => {
      const md = generateServicesMarkdown(registry);
      expect(md).toContain("**Problem:**");
    });

    it("includes deliverables section", () => {
      const md = generateServicesMarkdown(registry);
      expect(md).toContain("**Deliverables:**");
    });

    it("includes engagement field", () => {
      const md = generateServicesMarkdown(registry);
      expect(md).toContain("**Engagement:**");
    });
  });

  describe("generateAvailabilityMarkdown()", () => {
    it("returns a non-empty string", () => {
      const md = generateAvailabilityMarkdown(registry);
      expect(typeof md).toBe("string");
      expect(md.length).toBeGreaterThan(50);
    });

    it("contains availability heading", () => {
      const md = generateAvailabilityMarkdown(registry);
      expect(md).toContain("# AgentBadge Team Availability");
    });

    it("contains engagement types section", () => {
      const md = generateAvailabilityMarkdown(registry);
      expect(md).toContain("## Engagement types");
    });

    it("contains current capacity section", () => {
      const md = generateAvailabilityMarkdown(registry);
      expect(md).toContain("## Current capacity");
    });
  });

  describe("generateContactMarkdown()", () => {
    it("returns a non-empty string", () => {
      const md = generateContactMarkdown(registry);
      expect(typeof md).toBe("string");
      expect(md.length).toBeGreaterThan(50);
    });

    it("contains contact heading", () => {
      const md = generateContactMarkdown(registry);
      expect(md).toContain("# AgentBadge Team Contact");
    });

    it("includes person names", () => {
      const md = generateContactMarkdown(registry);
      for (const person of registry.people) {
        expect(md).toContain(person.name);
      }
    });

    it("includes primary channel", () => {
      const md = generateContactMarkdown(registry);
      expect(md).toContain("**Primary channel:**");
    });

    it("includes notes section", () => {
      const md = generateContactMarkdown(registry);
      expect(md).toContain("## Notes");
    });
  });

  describe("generateMatchMarkdown()", () => {
    it("returns a non-empty string", () => {
      const md = generateMatchMarkdown(registry);
      expect(typeof md).toBe("string");
      expect(md.length).toBeGreaterThan(50);
    });

    it("contains matching criteria heading", () => {
      const md = generateMatchMarkdown(registry);
      expect(md).toContain("# AgentBadge Team Matching Criteria");
    });

    it("contains available skills section", () => {
      const md = generateMatchMarkdown(registry);
      expect(md).toContain("## Available skills");
    });

    it("contains matching rules section", () => {
      const md = generateMatchMarkdown(registry);
      expect(md).toContain("## Matching rules");
    });

    it("mentions High, Medium, Low match levels", () => {
      const md = generateMatchMarkdown(registry);
      expect(md).toContain("High");
      expect(md).toContain("Medium");
      expect(md).toContain("Low");
    });
  });

  describe("Edge cases", () => {
    it("empty registry produces valid markdown", () => {
      const empty: RegistryIndex = {
        schema_version: "1.0",
        categories: [],
        skills: [],
        capabilities: [],
        services: [],
        people: [],
        warnings: [],
      };
      const md = generateCapabilitiesMarkdown(empty);
      expect(md).toContain("# AgentBadge Engineering Capabilities");
      expect(md).toContain("## Missing capability?");
    });

    it("empty registry services markdown has heading only", () => {
      const empty: RegistryIndex = {
        schema_version: "1.0",
        categories: [],
        skills: [],
        capabilities: [],
        services: [],
        people: [],
        warnings: [],
      };
      const md = generateServicesMarkdown(empty);
      expect(md).toContain("# AgentBadge Engineering Services");
    });
  });
});
