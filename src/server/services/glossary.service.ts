import type { GlossaryTermConfig } from "@agentbadge/hedera-core";
import glossaryJson from "../../data/glossary-terms.json";

const VALID_CATEGORIES = ["cardiovascular", "endocrine", "general", "demographic"] as const;

/**
 * Load and validate medical glossary terms from the JSON config file.
 *
 * @returns Array of validated GlossaryTermConfig objects
 * @throws if any term is missing required fields or has invalid category
 */
export function loadGlossaryTerms(): GlossaryTermConfig[] {
  const terms = glossaryJson as unknown[];

  if (!Array.isArray(terms)) {
    throw new Error("glossary-terms.json must be an array");
  }

  return terms.map((raw, i) => {
    const term = raw as Record<string, unknown>;

    if (typeof term.id !== "string" || !term.id) {
      throw new Error(`Glossary term at index ${i} is missing required field: id`);
    }
    if (typeof term.name !== "string" || !term.name) {
      throw new Error(`Glossary term '${term.id}' is missing required field: name`);
    }
    if (typeof term.description !== "string" || !term.description) {
      throw new Error(`Glossary term '${term.id}' is missing required field: description`);
    }
    if (typeof term.category !== "string" || !VALID_CATEGORIES.includes(term.category as typeof VALID_CATEGORIES[number])) {
      throw new Error(`Glossary term '${term.id}' has invalid category: ${term.category}`);
    }
    if (!Array.isArray(term.relatedDatasets) || term.relatedDatasets.length === 0) {
      throw new Error(`Glossary term '${term.id}' must have non-empty relatedDatasets array`);
    }

    return {
      id: term.id,
      name: term.name,
      description: term.description,
      category: term.category as GlossaryTermConfig["category"],
      relatedDatasets: term.relatedDatasets as string[],
    };
  });
}
