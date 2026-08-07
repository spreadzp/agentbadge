import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type {
  Category,
  Skill,
  Capability,
  Service,
  Person,
  RegistryIndex,
} from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONTENT_DIR = join(__dirname, "../../../content/team");

async function loadYamlDir<T>(dir: string): Promise<T[]> {
  const entries = await readdir(dir).catch(() => []);
  const yamlFiles = entries.filter((f) => f.endsWith(".yaml"));
  const items: T[] = [];
  for (const file of yamlFiles) {
    const content = await readFile(join(dir, file), "utf-8");
    const parsed = parseYaml(content) as T;
    items.push(parsed);
  }
  return items;
}

export async function loadRegistry(): Promise<RegistryIndex> {
  const [categories, skills, capabilities, services, people] = await Promise.all([
    loadYamlDir<Category>(join(CONTENT_DIR, "categories")),
    loadYamlDir<Skill>(join(CONTENT_DIR, "skills")),
    loadYamlDir<Capability>(join(CONTENT_DIR, "capabilities")),
    loadYamlDir<Service>(join(CONTENT_DIR, "services")),
    loadYamlDir<Person>(join(CONTENT_DIR, "people")),
  ]);

  const warnings: string[] = [];

  const categoryIds = new Set(categories.map((c) => c.id));
  const skillIds = new Set(skills.map((s) => s.id));
  const capabilityIds = new Set(capabilities.map((c) => c.id));
  const serviceIds = new Set(services.map((s) => s.id));
  const personIds = new Set(people.map((p) => p.id));

  for (const cap of capabilities) {
    if (!categoryIds.has(cap.category)) {
      warnings.push(`Capability "${cap.id}" references unknown category "${cap.category}"`);
    }
    for (const skillId of cap.skills) {
      if (!skillIds.has(skillId)) {
        warnings.push(`Capability "${cap.id}" references unknown skill "${skillId}"`);
      }
    }
    for (const serviceId of cap.services) {
      if (!serviceIds.has(serviceId)) {
        warnings.push(`Capability "${cap.id}" references unknown service "${serviceId}"`);
      }
    }
    for (const personId of cap.people) {
      if (!personIds.has(personId)) {
        warnings.push(`Capability "${cap.id}" references unknown person "${personId}"`);
      }
    }
  }

  for (const person of people) {
    for (const capId of person.capabilities) {
      if (!capabilityIds.has(capId)) {
        warnings.push(`Person "${person.id}" references unknown capability "${capId}"`);
      }
    }
  }

  for (const skill of skills) {
    if (!categoryIds.has(skill.category)) {
      warnings.push(`Skill "${skill.id}" references unknown category "${skill.category}"`);
    }
  }

  return {
    schema_version: "1.0",
    categories,
    skills,
    capabilities,
    services,
    people,
    warnings,
  };
}

let cachedRegistry: RegistryIndex | null = null;

export async function getRegistry(): Promise<RegistryIndex> {
  if (!cachedRegistry) {
    cachedRegistry = await loadRegistry();
  }
  return cachedRegistry;
}

export function clearRegistryCache(): void {
  cachedRegistry = null;
}
