/**
 * SLICE-201-14 (EPIC-201, track B): Knowledge Graph index generator.
 *
 * toKnowledgeIndex(articles) is a pure function: entities + edges derived from
 * BlogArticle metadata (topics/tags, technologies, concepts, entities,
 * capabilities, agentGuideSlug, relatedResources) with deterministic output —
 * entities sorted by id, edges sorted by (from,type,to), no timestamps.
 * Regenerating an index for unchanged input yields a byte-identical document
 * (CI drift-check, lesson of EPIC-178).
 */
import type { BlogArticle } from "../blog-data";
import {
  KNOWLEDGE_INDEX_VERSION,
  entityId,
  entitySlug,
  relatedResourceEntityType,
  type KnowledgeEdge,
  type KnowledgeEdgeType,
  type KnowledgeEntity,
  type KnowledgeEntityType,
} from "./entity-registry";

export interface KnowledgeIndex {
  version: typeof KNOWLEDGE_INDEX_VERSION;
  entities: Record<string, KnowledgeEntity>;
  edges: KnowledgeEdge[];
}

const PROJECT_ID = entityId("project", "agentbadge");

function lastUrlSegment(url: string): string {
  const clean = url.split(/[?#]/)[0].replace(/\/+$/, "");
  return clean.split("/").pop() ?? "";
}


export function toKnowledgeIndex(articles: BlogArticle[]): KnowledgeIndex {
  const entities = new Map<string, KnowledgeEntity>();
  const edgeKeys = new Set<string>();
  const edges: KnowledgeEdge[] = [];

  const addEntity = (
    type: KnowledgeEntityType,
    slug: string,
    label: string,
    ref?: string,
  ): string => {
    const id = entityId(type, slug);
    if (!entities.has(id)) {
      entities.set(id, { id, type, label, ...(ref ? { ref } : {}) });
    }
    return id;
  };

  const addEdge = (from: string, to: string, type: KnowledgeEdgeType) => {
    const key = `${from}${to}${type}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to, type });
  };

  // The single project node every article documents.
  addEntity("project", "agentbadge", "AgentBadge", "https://agentbadge.xyz");

  for (const article of articles) {
    const articleId = addEntity(
      "article",
      article.slug,
      article.title,
      `/blog/${article.slug}.json`,
    );
    addEdge(articleId, PROJECT_ID, "documents");

    for (const topic of article.topics ?? article.tags) {
      const id = addEntity("topic", topic, topic);
      addEdge(articleId, id, "covers");
    }
    for (const tech of article.technologies ?? []) {
      const id = addEntity("technology", tech, tech);
      addEdge(articleId, id, "uses");
    }
    for (const concept of article.concepts ?? []) {
      const id = addEntity("concept", concept, concept);
      addEdge(articleId, id, "introduces");
    }
    for (const entity of article.entities ?? []) {
      const id = addEntity("concept", entity, entity);
      addEdge(articleId, id, "mentions");
    }
    for (const cap of article.capabilities ?? []) {
      const id = addEntity("capability", cap, cap);
      addEdge(articleId, id, "demonstrates");
    }
    if (article.agentGuideSlug) {
      const id = addEntity(
        "guide",
        article.agentGuideSlug,
        article.agentGuideSlug,
        `/agent-guide/articles/${article.agentGuideSlug}`,
      );
      addEdge(articleId, id, "has-guide");
    }
    for (const res of article.relatedResources ?? []) {
      const type = relatedResourceEntityType(res.type);
      const slug =
        res.type === "guide"
          ? lastUrlSegment(res.url)
          : entitySlug(res.label);
      const id = addEntity(
        type,
        slug || entitySlug(res.url),
        res.label,
        res.url,
      );
      addEdge(articleId, id, "links");
    }
  }

  const sortedEntities: Record<string, KnowledgeEntity> = {};
  for (const id of [...entities.keys()].sort()) {
    sortedEntities[id] = entities.get(id)!;
  }
  edges.sort(
    (a, b) =>
      a.from.localeCompare(b.from) ||
      a.type.localeCompare(b.type) ||
      a.to.localeCompare(b.to),
  );

  return {
    version: KNOWLEDGE_INDEX_VERSION,
    entities: sortedEntities,
    edges,
  };
}
