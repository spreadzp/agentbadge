import * as yaml from "yaml";
import type { KnowledgeProfile } from "../../profile/profile-schema";

/**
 * SLICE-101-7: YAML Renderer.
 *
 * Pure function: renders a KnowledgeProfile as YAML.
 * Uses the `yaml` package (already in dependencies).
 */

export function renderProfileYaml(profile: KnowledgeProfile): string {
  return yaml.stringify(profile);
}
