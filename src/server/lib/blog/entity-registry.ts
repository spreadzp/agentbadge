/**
 * SLICE-201-14 (EPIC-201, track B): entity registry — the single generator of
 * canonical ids and controlled vocabularies for the Knowledge Graph index.
 *
 * ID convention (D-201-17 canonical ids live here, nowhere else):
 *   <type>:<slug>  — article:arc-c29-task-board, project:agentbadge,
 *                    technology:arc, capability:task-discovery,
 *                    guide:hire-or-get-hired
 *
 * Entity types: article | project | technology | capability | guide |
 *               concept | topic | resource
 * Edge types:   covers | uses | introduces | demonstrates | has-guide |
 *               links | documents | mentions
 */
import type { RelatedResourceType } from "./knowledge-object";

export type KnowledgeEntityType =
  | "article"
  | "project"
  | "technology"
  | "capability"
  | "guide"
  | "concept"
  | "topic"
  | "resource";

export type KnowledgeEdgeType =
  | "covers"
  | "uses"
  | "introduces"
  | "demonstrates"
  | "has-guide"
  | "links"
  | "documents"
  | "mentions";

export interface KnowledgeEntity {
  id: string;
  type: KnowledgeEntityType;
  label: string;
  /** Resolvable URL when the entity has a live representation. */
  ref?: string;
}

export interface KnowledgeEdge {
  from: string;
  to: string;
  type: KnowledgeEdgeType;
}

export const KNOWLEDGE_INDEX_VERSION = "1.0.0";

/** Lowercase, non-alphanumerics collapse to single dashes. */
export function entitySlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

export function entityId(type: KnowledgeEntityType, slug: string): string {
  return `${type}:${entitySlug(slug)}`;
}

/**
 * Map a relatedResources type to the entity type its target belongs to.
 * task-board is a capability; team-profile resolves to the project itself.
 */
export function relatedResourceEntityType(
  resourceType: RelatedResourceType,
): KnowledgeEntityType {
  switch (resourceType) {
    case "guide":
      return "guide";
    case "project":
      return "project";
    case "task-board":
      return "capability";
    case "github":
    case "team-profile":
      return "resource";
  }
}
