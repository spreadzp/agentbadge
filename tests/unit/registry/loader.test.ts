import { describe, it, expect, beforeEach } from "vitest";
import { loadRegistry, getRegistry, clearRegistryCache } from "../../../src/server/registry/loader";
import type { RegistryIndex } from "../../../src/server/registry/types";

describe("SLICE-46-13: Registry Loader — unit tests", () => {
  beforeEach(() => {
    clearRegistryCache();
  });

  describe("loadRegistry()", () => {
    it("returns a RegistryIndex object", async () => {
      const registry = await loadRegistry();
      expect(registry).toBeDefined();
      expect(registry.schema_version).toBe("1.0");
    });

    it("loads categories array", async () => {
      const registry = await loadRegistry();
      expect(Array.isArray(registry.categories)).toBe(true);
      expect(registry.categories.length).toBeGreaterThanOrEqual(3);
    });

    it("loads skills array", async () => {
      const registry = await loadRegistry();
      expect(Array.isArray(registry.skills)).toBe(true);
      expect(registry.skills.length).toBeGreaterThanOrEqual(5);
    });

    it("loads capabilities array", async () => {
      const registry = await loadRegistry();
      expect(Array.isArray(registry.capabilities)).toBe(true);
      expect(registry.capabilities.length).toBeGreaterThanOrEqual(1);
    });

    it("loads services array", async () => {
      const registry = await loadRegistry();
      expect(Array.isArray(registry.services)).toBe(true);
      expect(registry.services.length).toBeGreaterThanOrEqual(1);
    });

    it("loads people array", async () => {
      const registry = await loadRegistry();
      expect(Array.isArray(registry.people)).toBe(true);
      expect(registry.people.length).toBeGreaterThanOrEqual(1);
    });

    it("returns warnings array", async () => {
      const registry = await loadRegistry();
      expect(Array.isArray(registry.warnings)).toBe(true);
    });

    it("each category has id and name", async () => {
      const registry = await loadRegistry();
      for (const cat of registry.categories) {
        expect(cat.id).toBeDefined();
        expect(typeof cat.id).toBe("string");
        expect(cat.name).toBeDefined();
        expect(typeof cat.name).toBe("string");
      }
    });

    it("each skill has id, name, and category", async () => {
      const registry = await loadRegistry();
      for (const skill of registry.skills) {
        expect(skill.id).toBeDefined();
        expect(skill.name).toBeDefined();
        expect(skill.category).toBeDefined();
      }
    });

    it("each capability has required fields", async () => {
      const registry = await loadRegistry();
      for (const cap of registry.capabilities) {
        expect(cap.id).toBeDefined();
        expect(cap.name).toBeDefined();
        expect(cap.category).toBeDefined();
        expect(Array.isArray(cap.skills)).toBe(true);
        expect(Array.isArray(cap.services)).toBe(true);
        expect(Array.isArray(cap.people)).toBe(true);
        expect(Array.isArray(cap.evidence)).toBe(true);
        expect(cap.status).toBeDefined();
        expect(typeof cap.confidence).toBe("number");
      }
    });

    it("each person has required fields", async () => {
      const registry = await loadRegistry();
      for (const person of registry.people) {
        expect(person.id).toBeDefined();
        expect(person.name).toBeDefined();
        expect(Array.isArray(person.roles)).toBe(true);
        expect(Array.isArray(person.capabilities)).toBe(true);
        expect(person.availability).toBeDefined();
        expect(person.contact).toBeDefined();
        expect(person.contact.primary).toBeDefined();
        expect(Array.isArray(person.contact.channels)).toBe(true);
      }
    });
  });

  describe("Cross-references", () => {
    it("capability.category references valid category", async () => {
      const registry = await loadRegistry();
      const catIds = new Set(registry.categories.map((c) => c.id));
      for (const cap of registry.capabilities) {
        expect(catIds.has(cap.category)).toBe(true);
      }
    });

    it("capability.skills reference valid skills", async () => {
      const registry = await loadRegistry();
      const skillIds = new Set(registry.skills.map((s) => s.id));
      for (const cap of registry.capabilities) {
        for (const skillId of cap.skills) {
          expect(skillIds.has(skillId)).toBe(true);
        }
      }
    });

    it("capability.services reference valid services", async () => {
      const registry = await loadRegistry();
      const serviceIds = new Set(registry.services.map((s) => s.id));
      for (const cap of registry.capabilities) {
        for (const svcId of cap.services) {
          expect(serviceIds.has(svcId)).toBe(true);
        }
      }
    });

    it("capability.people reference valid people", async () => {
      const registry = await loadRegistry();
      const personIds = new Set(registry.people.map((p) => p.id));
      for (const cap of registry.capabilities) {
        for (const personId of cap.people) {
          expect(personIds.has(personId)).toBe(true);
        }
      }
    });

    it("person.capabilities reference valid capabilities", async () => {
      const registry = await loadRegistry();
      const capIds = new Set(registry.capabilities.map((c) => c.id));
      for (const person of registry.people) {
        for (const capId of person.capabilities) {
          expect(capIds.has(capId)).toBe(true);
        }
      }
    });

    it("skill.category references valid category", async () => {
      const registry = await loadRegistry();
      const catIds = new Set(registry.categories.map((c) => c.id));
      for (const skill of registry.skills) {
        expect(catIds.has(skill.category)).toBe(true);
      }
    });
  });

  describe("getRegistry() cache", () => {
    it("returns same instance on second call", async () => {
      const r1 = await getRegistry();
      const r2 = await getRegistry();
      expect(r1).toBe(r2);
    });

    it("clearRegistryCache() forces reload", async () => {
      const r1 = await getRegistry();
      clearRegistryCache();
      const r2 = await getRegistry();
      expect(r1).not.toBe(r2);
      expect(r1.schema_version).toBe(r2.schema_version);
    });
  });

  describe("Edge cases", () => {
    it("empty registry has empty arrays", () => {
      const empty: RegistryIndex = {
        schema_version: "1.0",
        categories: [],
        skills: [],
        capabilities: [],
        services: [],
        people: [],
        warnings: [],
      };
      expect(empty.categories.length).toBe(0);
      expect(empty.capabilities.length).toBe(0);
      expect(empty.warnings.length).toBe(0);
    });

    it("registry with single capability works", async () => {
      const registry = await loadRegistry();
      expect(registry.capabilities.length).toBeGreaterThanOrEqual(1);
      const cap = registry.capabilities[0];
      expect(cap.id).toBeDefined();
      expect(cap.name).toBeDefined();
    });
  });
});
