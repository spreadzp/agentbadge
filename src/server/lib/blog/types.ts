// SLICE-218-5: article type contracts extracted from blog-data.ts
// (file exceeded eslint max-lines=300). Re-exported from blog-data,
// so existing `import { BlogArticle } from "../lib/blog-data"` call
// sites keep working unchanged.
import type { RelatedLinkItem } from "../../../views/related-links";

export interface BlogExternalLink {
  platform:
  | "devto"
  | "medium"
  | "linkedin"
  | "hackernews"
  | "hackernoon"
  | "reddit"
  | "github"
  | "hashnode"
  | "twitter"
  | "qiita"
  | "zenn"
  | "velog"
  | "hsoub";
  url: string;
}

export interface BlogArticle {
  slug: string;
  title: string;
  description: string;
  author: string;
  authorRole: string;
  date: string;
  dateModified?: string;
  tags: string[];
  readingTime: string;
  content: string;
  markdown?: string;
  agentGuideSlug?: string;
  heroImage?: string;
  ogImage?: string;
  /** SLICE-217-14: Hedera-era content kept for history; card shows a
   * "legacy" badge instead of pretending the stack is current. */
  legacy?: boolean;
  shortAnswer?: string;
  // SLICE-218-5 (D-218-6): canonical override when an authority page
  // owns this intent. Absent = self-canonical /blog/<slug>.
  canonical?: string;
  externalLinks?: BlogExternalLink[];
  relatedLinks?: RelatedLinkItem[];
  // SLICE-201-5 (EPIC-201 track B): Knowledge Object v1 metadata.
  // All optional — toKnowledgeObject derives values when absent
  // (status defaults to LIVE; topics/concepts from tags; qa from
  // question-style H2s; claims from shortAnswer as UNVERIFIED draft).
  status?:
  | "IDEA"
  | "EXPERIMENT"
  | "PROTOTYPE"
  | "LIVE"
  | "PRODUCTION"
  | "ARCHIVED";
  topics?: string[];
  concepts?: string[];
  rules?: string[];
  capabilities?: string[];
  technologies?: string[];
  entities?: string[];
  actions?: import("./knowledge-object").KnowledgeAction[];
  qa?: import("./knowledge-object").KnowledgeQa[];
  claims?: import("./knowledge-object").KnowledgeClaim[];
  economicContext?: import("./knowledge-object").EconomicContext;
  relatedResources?: import("./knowledge-object").RelatedResource[];
}

export interface PaginationMeta {
  currentPage: number;
  totalPages: number;
  totalArticles: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface BlogChannel {
  key: string;
  label: string;
  tags: string[];
}
