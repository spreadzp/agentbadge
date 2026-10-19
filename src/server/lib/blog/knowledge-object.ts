/**
 * SLICE-201-5 (EPIC-201, track B): Content Knowledge Object v1 — the
 * machine-readable projection of a BlogArticle served at /blog/:slug.json.
 *
 * Vocabularies are controlled and mirrored by public/schemas/content/v1.json:
 *   status                IDEA | EXPERIMENT | PROTOTYPE | LIVE | PRODUCTION | ARCHIVED
 *   claims[].status       VERIFIED | INFERRED | EXPERIMENTAL | UNVERIFIED | CONFLICT
 *   claims[].evidence[]   {type: github | demo | transaction | test, url}
 *   actions[]             {type: read | view-demo | view-code | contact, label, url}
 *   relatedResources[]    {type: project | guide | github | task-board | team-profile, label, url}
 *
 * Derivation rules (auto-backfill, D-201-16/17): explicit BlogArticle fields
 * always win; otherwise topics/concepts come from tags, qa from question-style
 * H2 headings (fallback: shortAnswer), claims from shortAnswer (UNVERIFIED
 * draft — finalized by SLICE-201-9 / human), actions from read + derivable
 * view-code/view-demo links.
 */
import { BASE_URL } from "../page-meta";
import type { BlogArticle } from "../blog-data";

export type ContentStatus =
  | "IDEA"
  | "EXPERIMENT"
  | "PROTOTYPE"
  | "LIVE"
  | "PRODUCTION"
  | "ARCHIVED";

export type ClaimStatus =
  | "VERIFIED"
  | "INFERRED"
  | "EXPERIMENTAL"
  | "UNVERIFIED"
  | "CONFLICT";

export type EvidenceType = "github" | "demo" | "transaction" | "test";
export type ActionType = "read" | "view-demo" | "view-code" | "contact";
export type RelatedResourceType =
  | "project"
  | "guide"
  | "github"
  | "task-board"
  | "team-profile";

export interface KnowledgeEvidence {
  type: EvidenceType;
  url: string;
}

export interface KnowledgeClaim {
  id: string;
  text: string;
  status: ClaimStatus;
  evidence?: KnowledgeEvidence[];
}

export interface KnowledgeAction {
  type: ActionType;
  label: string;
  url: string;
}

export interface KnowledgeQa {
  question: string;
  answer: string;
}

export interface RelatedResource {
  type: RelatedResourceType;
  label: string;
  url: string;
}

export interface EconomicContext {
  endpoints: Record<string, string>;
  payment: { supported: boolean; currency: string };
}

export interface KnowledgeObject {
  type: "article";
  schemaVersion: "1";
  slug: string;
  title: string;
  description: string;
  shortAnswer?: string;
  status: ContentStatus;
  topics: string[];
  concepts: string[];
  rules: string[];
  capabilities: string[];
  technologies?: string[];
  entities?: string[];
  actions: KnowledgeAction[];
  qa: KnowledgeQa[];
  claims: KnowledgeClaim[];
  canonical: string;
  dates: { published: string; modified: string };
  markdownUrl: string;
  jsonUrl: string;
  economicContext?: EconomicContext;
  relatedResources?: RelatedResource[];
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Extract Q/A pairs from question-style H2 headings (reused by SLICE-201-11
 * for the visible Agent Context block). Each answer is the first paragraph
 * after the heading, stripped and truncated. Exported for reuse.
 */
export function extractQaFromContent(html: string, maxItems = 8): KnowledgeQa[] {
  const qa: KnowledgeQa[] = [];
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null && qa.length < maxItems) {
    const heading = stripHtml(match[1]);
    if (!heading.endsWith("?")) continue;
    const rest = html.slice(match.index + match[0].length);
    const p = rest.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const answer = p ? truncate(stripHtml(p[1]), 300) : "";
    qa.push({
      question: heading,
      answer: answer || "See the article section for details.",
    });
  }
  return qa;
}

function deriveEvidence(article: BlogArticle): KnowledgeEvidence[] {
  const evidence: KnowledgeEvidence[] = [];
  for (const link of article.externalLinks ?? []) {
    if (link.platform === "github") {
      evidence.push({ type: "github", url: link.url });
    }
  }
  for (const link of article.relatedLinks ?? []) {
    if (/github\.com/i.test(link.href)) {
      evidence.push({ type: "github", url: link.href });
    }
  }
  return evidence;
}

function deriveActions(article: BlogArticle, canonical: string): KnowledgeAction[] {
  const actions: KnowledgeAction[] = [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: `${canonical}.md`,
    },
    {
      type: "view-demo",
      label: "Run Agent Readiness scan",
      url: `${BASE_URL}/scan?src=article:${article.slug}`,
    },
  ];
  const seen = new Set<string>();
  const push = (type: ActionType, label: string, url: string) => {
    const key = `${type}:${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    actions.push({ type, label, url });
  };
  for (const link of article.relatedLinks ?? []) {
    if (/github\.com/i.test(link.href)) {
      push("view-code", link.label, link.href);
    } else if (/demo|playground|try/i.test(link.href + link.label)) {
      push("view-demo", link.label, link.href);
    }
  }
  for (const link of article.externalLinks ?? []) {
    if (link.platform === "github") {
      push("view-code", "Source code (GitHub)", link.url);
    }
  }
  return actions;
}

function deriveRelatedResources(article: BlogArticle): RelatedResource[] {
  const resources: RelatedResource[] = [];
  if (article.agentGuideSlug) {
    resources.push({
      type: "guide",
      label: "Agent guide",
      url: `${BASE_URL}/agent-guide/articles/${article.agentGuideSlug}`,
    });
  }
  for (const link of article.relatedLinks ?? []) {
    if (/github\.com/i.test(link.href)) {
      resources.push({ type: "github", label: link.label, url: link.href });
    }
  }
  return resources;
}

/**
 * Build the Content Knowledge Object v1 for an article. Pure and
 * deterministic — regenerating an object for unchanged input yields an
 * identical result (CI drift-check).
 */
export function toKnowledgeObject(article: BlogArticle): KnowledgeObject {
  const canonical = `${BASE_URL}/blog/${article.slug}`;
  const topics = article.topics ?? article.tags;
  const qa =
    article.qa && article.qa.length > 0
      ? article.qa
      : (() => {
        const extracted = extractQaFromContent(article.content);
        return extracted.length > 0
          ? extracted
          : [
            {
              question: `What is "${article.title}" about?`,
              answer: truncate(
                article.shortAnswer ?? article.description,
                300,
              ),
            },
          ];
      })();
  const claims: KnowledgeClaim[] =
    article.claims && article.claims.length > 0
      ? article.claims
      : [
        {
          id: "claim-1",
          text: article.shortAnswer ?? article.description,
          status: "UNVERIFIED",
          evidence: deriveEvidence(article),
        },
      ];

  const obj: KnowledgeObject = {
    type: "article",
    schemaVersion: "1",
    slug: article.slug,
    title: article.title,
    description: article.description,
    status: article.status ?? "LIVE",
    topics,
    concepts: article.concepts ?? topics,
    rules: article.rules ?? [],
    capabilities: article.capabilities ?? [],
    actions: article.actions ?? deriveActions(article, canonical),
    qa,
    claims,
    canonical,
    dates: {
      published: article.date,
      modified: article.dateModified ?? article.date,
    },
    markdownUrl: `${canonical}.md`,
    jsonUrl: `${canonical}.json`,
  };
  if (article.shortAnswer) obj.shortAnswer = article.shortAnswer;
  if (article.technologies?.length) obj.technologies = article.technologies;
  if (article.entities?.length) obj.entities = article.entities;
  if (article.economicContext) obj.economicContext = article.economicContext;
  const related = article.relatedResources ?? deriveRelatedResources(article);
  if (related.length) obj.relatedResources = related;
  return obj;
}
