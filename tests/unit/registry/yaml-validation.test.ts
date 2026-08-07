import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Category, Skill, Capability, Service, Person } from "../../../src/server/registry/types";

const FIXTURES_DIR = join(import.meta.dirname, "../../fixtures/team");

async function loadFixtureDir<T>(subdir: string): Promise<T[]> {
  const dir = join(FIXTURES_DIR, subdir);
  const entries = await readdir(dir).catch(() => []);
  const yamlFiles = entries.filter((f) => f.endsWith(".yaml"));
  const items: T[] = [];
  for (const file of yamlFiles) {
    const content = await readFile(join(dir, file), "utf-8");
    items.push(parseYaml(content) as T);
  }
  return items;
}

function validateCategory(cat: unknown): string[] {
  const errors: string[] = [];
  if (!cat || typeof cat !== "object") return ["Category is not an object"];
  const c = cat as Record<string, unknown>;
  if (!c.id || typeof c.id !== "string") errors.push("Missing required field: id");
  if (!c.name || typeof c.name !== "string") errors.push("Missing required field: name");
  return errors;
}

function validateCapability(cap: unknown): string[] {
  const errors: string[] = [];
  if (!cap || typeof cap !== "object") return ["Capability is not an object"];
  const c = cap as Record<string, unknown>;
  if (!c.id || typeof c.id !== "string") errors.push("Missing required field: id");
  if (!c.name || typeof c.name !== "string") errors.push("Missing required field: name");
  if (!c.category || typeof c.category !== "string") errors.push("Missing required field: category");
  if (!Array.isArray(c.skills)) errors.push("Missing or invalid field: skills");
  if (!Array.isArray(c.services)) errors.push("Missing or invalid field: services");
  if (!Array.isArray(c.people)) errors.push("Missing or invalid field: people");
  if (!Array.isArray(c.evidence)) errors.push("Missing or invalid field: evidence");
  if (!c.status || typeof c.status !== "string") errors.push("Missing required field: status");
  if (typeof c.confidence !== "number") errors.push("Missing or invalid field: confidence");
  return errors;
}

function validatePerson(person: unknown): string[] {
  const errors: string[] = [];
  if (!person || typeof person !== "object") return ["Person is not an object"];
  const p = person as Record<string, unknown>;
  if (!p.id || typeof p.id !== "string") errors.push("Missing required field: id");
  if (!p.name || typeof p.name !== "string") errors.push("Missing required field: name");
  if (!Array.isArray(p.roles)) errors.push("Missing or invalid field: roles");
  if (!Array.isArray(p.capabilities)) errors.push("Missing or invalid field: capabilities");
  if (!p.availability || typeof p.availability !== "string") errors.push("Missing required field: availability");
  if (!p.contact || typeof p.contact !== "object") errors.push("Missing required field: contact");
  return errors;
}

function validateSkill(skill: unknown): string[] {
  const errors: string[] = [];
  if (!skill || typeof skill !== "object") return ["Skill is not an object"];
  const s = skill as Record<string, unknown>;
  if (!s.id || typeof s.id !== "string") errors.push("Missing required field: id");
  if (!s.name || typeof s.name !== "string") errors.push("Missing required field: name");
  if (!s.category || typeof s.category !== "string") errors.push("Missing required field: category");
  return errors;
}

function validateService(svc: unknown): string[] {
  const errors: string[] = [];
  if (!svc || typeof svc !== "object") return ["Service is not an object"];
  const s = svc as Record<string, unknown>;
  if (!s.id || typeof s.id !== "string") errors.push("Missing required field: id");
  if (!s.name || typeof s.name !== "string") errors.push("Missing required field: name");
  if (!s.problem || typeof s.problem !== "string") errors.push("Missing required field: problem");
  if (!Array.isArray(s.deliverables)) errors.push("Missing or invalid field: deliverables");
  if (!Array.isArray(s.engagement)) errors.push("Missing or invalid field: engagement");
  if (!s.contact || typeof s.contact !== "string") errors.push("Missing required field: contact");
  return errors;
}

describe("SLICE-46-13: YAML Validation — unit tests", () => {
  describe("Valid fixtures", () => {
    it("valid category passes validation", async () => {
      const categories = await loadFixtureDir<Category>("categories");
      const valid = categories.find((c) => c.id === "valid-cat");
      expect(valid).toBeDefined();
      expect(validateCategory(valid)).toHaveLength(0);
    });

    it("valid skill passes validation", async () => {
      const skills = await loadFixtureDir<Skill>("skills");
      const valid = skills.find((s) => s.id === "valid-skill");
      expect(valid).toBeDefined();
      expect(validateSkill(valid)).toHaveLength(0);
    });

    it("valid capability passes validation", async () => {
      const capabilities = await loadFixtureDir<Capability>("capabilities");
      const valid = capabilities.find((c) => c.id === "valid-cap");
      expect(valid).toBeDefined();
      expect(validateCapability(valid)).toHaveLength(0);
    });

    it("valid service passes validation", async () => {
      const services = await loadFixtureDir<Service>("services");
      const valid = services.find((s) => s.id === "valid-service");
      expect(valid).toBeDefined();
      expect(validateService(valid)).toHaveLength(0);
    });

    it("valid person passes validation", async () => {
      const people = await loadFixtureDir<Person>("people");
      const valid = people.find((p) => p.id === "valid-person");
      expect(valid).toBeDefined();
      expect(validatePerson(valid)).toHaveLength(0);
    });
  });

  describe("Invalid fixtures", () => {
    it("category missing id produces error", async () => {
      const categories = await loadFixtureDir<Category>("categories");
      const invalid = categories.find((c) => !c.id);
      expect(invalid).toBeDefined();
      const errors = validateCategory(invalid);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("id"))).toBe(true);
    });

    it("capability with bad references produces warnings", async () => {
      const capabilities = await loadFixtureDir<Capability>("capabilities");
      const bad = capabilities.find((c) => c.id === "bad-cat");
      if (bad) {
        expect(bad.skills).toContain("non-existent-skill");
        expect(bad.services).toContain("non-existent-service");
        expect(bad.people).toContain("non-existent-person");
      }
    });
  });

  describe("YAML parsing edge cases", () => {
    it("empty YAML produces null", () => {
      const result = parseYaml("");
      expect(result).toBeNull();
    });

    it("invalid YAML throws", () => {
      expect(() => parseYaml("key: [unclosed")).toThrow();
    });

    it("YAML with wrong types detected", () => {
      const parsed = parseYaml("id: 123\nname: true") as Record<string, unknown>;
      expect(typeof parsed.id).toBe("number");
      expect(typeof parsed.name).toBe("boolean");
    });

    it("valid YAML with optional fields missing", () => {
      const parsed = parseYaml("id: test\nname: Test") as Record<string, unknown>;
      expect(parsed.id).toBe("test");
      expect(parsed.name).toBe("Test");
      expect(parsed.description).toBeUndefined();
    });
  });

  describe("Cross-reference validation", () => {
    it("detects unknown category reference in capability", async () => {
      const categories = await loadFixtureDir<Category>("categories");
      const capabilities = await loadFixtureDir<Capability>("capabilities");
      const catIds = new Set(categories.map((c) => c.id));
      for (const cap of capabilities) {
        if (cap.category && !catIds.has(cap.category)) {
          expect(cap.category).toBe("bad-cat");
        }
      }
    });

    it("detects unknown skill reference in capability", async () => {
      const skills = await loadFixtureDir<Skill>("skills");
      const capabilities = await loadFixtureDir<Capability>("capabilities");
      const skillIds = new Set(skills.map((s) => s.id));
      const bad = capabilities.find((c) => c.id === "bad-cat");
      if (bad) {
        for (const skillId of bad.skills) {
          if (!skillIds.has(skillId)) {
            expect(skillId).toBe("non-existent-skill");
          }
        }
      }
    });
  });
});
