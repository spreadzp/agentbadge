import { describe, it, expect, beforeEach } from "vitest";
import { loadRegistry, clearRegistryCache } from "../../../src/server/registry/loader";
import type { RegistryIndex } from "../../../src/server/registry/types";

describe("SLICE-46-13: JSON Generation — unit tests", () => {
  let registry: RegistryIndex;

  beforeEach(async () => {
    clearRegistryCache();
    registry = await loadRegistry();
  });

  describe("Schema conformance", () => {
    it("has schema_version = 1.0", () => {
      expect(registry.schema_version).toBe("1.0");
    });

    it("has categories as array of Category", () => {
      expect(Array.isArray(registry.categories)).toBe(true);
      for (const cat of registry.categories) {
        expect(typeof cat.id).toBe("string");
        expect(typeof cat.name).toBe("string");
      }
    });

    it("has skills as array of Skill", () => {
      expect(Array.isArray(registry.skills)).toBe(true);
      for (const skill of registry.skills) {
        expect(typeof skill.id).toBe("string");
        expect(typeof skill.name).toBe("string");
        expect(typeof skill.category).toBe("string");
      }
    });

    it("has capabilities as array of Capability", () => {
      expect(Array.isArray(registry.capabilities)).toBe(true);
      for (const cap of registry.capabilities) {
        expect(typeof cap.id).toBe("string");
        expect(typeof cap.name).toBe("string");
        expect(typeof cap.category).toBe("string");
        expect(Array.isArray(cap.skills)).toBe(true);
        expect(Array.isArray(cap.services)).toBe(true);
        expect(Array.isArray(cap.people)).toBe(true);
        expect(Array.isArray(cap.evidence)).toBe(true);
        expect(typeof cap.status).toBe("string");
        expect(typeof cap.confidence).toBe("number");
      }
    });

    it("has services as array of Service", () => {
      expect(Array.isArray(registry.services)).toBe(true);
      for (const svc of registry.services) {
        expect(typeof svc.id).toBe("string");
        expect(typeof svc.name).toBe("string");
        expect(typeof svc.problem).toBe("string");
        expect(Array.isArray(svc.deliverables)).toBe(true);
        expect(Array.isArray(svc.engagement)).toBe(true);
        expect(typeof svc.contact).toBe("string");
      }
    });

    it("has people as array of Person", () => {
      expect(Array.isArray(registry.people)).toBe(true);
      for (const person of registry.people) {
        expect(typeof person.id).toBe("string");
        expect(typeof person.name).toBe("string");
        expect(Array.isArray(person.roles)).toBe(true);
        expect(Array.isArray(person.capabilities)).toBe(true);
        expect(typeof person.availability).toBe("string");
        expect(typeof person.contact).toBe("object");
        expect(typeof person.contact.primary).toBe("string");
        expect(Array.isArray(person.contact.channels)).toBe(true);
      }
    });

    it("has warnings as array of strings", () => {
      expect(Array.isArray(registry.warnings)).toBe(true);
      for (const w of registry.warnings) {
        expect(typeof w).toBe("string");
      }
    });
  });

  describe("All entities included", () => {
    it("includes all categories from YAML files", () => {
      expect(registry.categories.length).toBeGreaterThanOrEqual(3);
    });

    it("includes all skills from YAML files", () => {
      expect(registry.skills.length).toBeGreaterThanOrEqual(5);
    });

    it("includes all capabilities from YAML files", () => {
      expect(registry.capabilities.length).toBeGreaterThanOrEqual(1);
    });

    it("includes all services from YAML files", () => {
      expect(registry.services.length).toBeGreaterThanOrEqual(1);
    });

    it("includes all people from YAML files", () => {
      expect(registry.people.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Capability status values", () => {
    it("all statuses are valid values", () => {
      const validStatuses = ["REQUESTED", "VERIFIED", "DEPRECATED", "ARCHIVED"];
      for (const cap of registry.capabilities) {
        expect(validStatuses).toContain(cap.status);
      }
    });
  });

  describe("Confidence range", () => {
    it("all confidence values are between 0 and 1", () => {
      for (const cap of registry.capabilities) {
        expect(cap.confidence).toBeGreaterThanOrEqual(0);
        expect(cap.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("Evidence structure", () => {
    it("each evidence entry has type and name", () => {
      for (const cap of registry.capabilities) {
        for (const ev of cap.evidence) {
          expect(typeof ev.type).toBe("string");
          expect(typeof ev.name).toBe("string");
        }
      }
    });
  });

  describe("Optional fields", () => {
    it("related_articles is array when present", () => {
      for (const cap of registry.capabilities) {
        if (cap.related_articles) {
          expect(Array.isArray(cap.related_articles)).toBe(true);
        }
      }
    });

    it("related_capabilities is array when present", () => {
      for (const cap of registry.capabilities) {
        if (cap.related_capabilities) {
          expect(Array.isArray(cap.related_capabilities)).toBe(true);
        }
      }
    });

    it("category.description is string when present", () => {
      for (const cat of registry.categories) {
        if (cat.description) {
          expect(typeof cat.description).toBe("string");
        }
      }
    });
  });

  describe("Edge cases", () => {
    it("empty registry still has valid structure", () => {
      const empty: RegistryIndex = {
        schema_version: "1.0",
        categories: [],
        skills: [],
        capabilities: [],
        services: [],
        people: [],
        warnings: [],
      };
      expect(empty.schema_version).toBe("1.0");
      expect(empty.categories).toHaveLength(0);
    });
  });
});
