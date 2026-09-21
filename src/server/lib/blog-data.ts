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
  shortAnswer?: string;
  externalLinks?: BlogExternalLink[];
  relatedLinks?: RelatedLinkItem[];
}

import { RelatedLinkItem } from "../../views/related-links";
// EPIC-140 (SLICE-140-10): article content split to ./blog/articles/*.ts
// Local import (helpers below reference BLOG_ARTICLES) + re-export for old import path.
import { BLOG_ARTICLES } from "./blog/articles";
export { BLOG_ARTICLES };

// --- Markdown generation (SLICE-60-2) ---

const BASE_URL_FOR_MD =
  process.env.BASE_URL && process.env.BASE_URL.startsWith("http")
    ? process.env.BASE_URL
    : "https://agentbadge.xyz";

function htmlToMarkdown(html: string): string {
  let md = html;

  // Pre/code blocks — extract and preserve
  const codeBlocks: string[] = [];
  md = md.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (_m, code) => {
    const decoded = code
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    codeBlocks.push(decoded);
    return `\x00CODEBLOCK${codeBlocks.length - 1}\x00`;
  });

  // Headings
  md = md.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g, (_m, level, content) => {
    const hashes = "#".repeat(Number(level));
    return `\n\n${hashes} ${stripTags(content).trim()}\n\n`;
  });

  // Links — resolve relative URLs to absolute
  md = md.replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_m, href, text) => {
    const cleanText = stripTags(text).trim();
    const absHref = href.startsWith("/") ? `${BASE_URL_FOR_MD}${href}` : href;
    return `[${cleanText}](${absHref})`;
  });

  // Bold and italic
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/g, "**$1**");
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/g, "*$1*");

  // Images
  md = md.replace(/<img\s+[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/g, "![$2]($1)");

  // Lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/g, (_m, list) => {
    return list
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/g, "- $1\n")
      .replace(/\n$/, "");
  });
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/g, (_m, list) => {
    let i = 1;
    return list
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/g, (_m: string, content: string) => `${i++}. ${content}\n`)
      .replace(/\n$/, "");
  });

  // Tables — convert to markdown tables
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/g, (_m, table) => {
    const rows: string[][] = [];
    const rowMatches = table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g);
    for (const rowMatch of rowMatches) {
      const cells: string[] = [];
      const cellMatches = rowMatch[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g);
      for (const cellMatch of cellMatches) {
        cells.push(stripTags(cellMatch[1]).trim());
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length === 0) return "";
    const header = rows[0];
    const separator = header.map(() => "---");
    const lines = [
      `| ${header.join(" | ")} |`,
      `| ${separator.join(" | ")} |`,
      ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`),
    ];
    return `\n\n${lines.join("\n")}\n\n`;
  });

  // Paragraphs and line breaks
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/g, "\n\n$1\n\n");
  md = md.replace(/<br\s*\/?>/g, "\n");

  // Strip remaining tags
  md = stripTags(md);

  // Decode HTML entities
  md = md
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Restore code blocks
  md = md.replace(/\x00CODEBLOCK(\d+)\x00/g, (_m, idx) => {
    return `\n\`\`\`\n${codeBlocks[Number(idx)]}\n\`\`\`\n`;
  });

  // Clean up extra whitespace
  md = md.replace(/\n{3,}/g, "\n\n").trim();

  return md;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function generateArticleMarkdown(article: BlogArticle): string {
  const header = `# ${article.title}\n\n> Published: ${article.date} | Author: ${article.author} | Canonical: ${BASE_URL_FOR_MD}/blog/${article.slug}\n`;

  const body = htmlToMarkdown(article.content);

  const aiAgentsSection = `\n---\n\n## For AI Agents\n\n- Companion guide: ${BASE_URL_FOR_MD}/agent-guide/articles/${article.agentGuideSlug ?? article.slug}\n- Knowledge Index: ${BASE_URL_FOR_MD}/agent-guide/\n- LLM entry point: ${BASE_URL_FOR_MD}/llms.txt\n- Engineering services: ${BASE_URL_FOR_MD}/agent-guide/team/services\n`;

  return `${header}\n${body}\n${aiAgentsSection}`;
}

// Populate markdown field for all articles
for (const article of BLOG_ARTICLES) {
  if (!article.markdown) {
    article.markdown = generateArticleMarkdown(article);
  }
}

export const ARTICLES_PER_PAGE = 9;

export interface PaginationMeta {
  currentPage: number;
  totalPages: number;
  totalArticles: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export function paginateArticles(
  articles: BlogArticle[],
  page: number | undefined,
): { items: BlogArticle[]; meta: PaginationMeta } {
  const totalArticles = articles.length;
  const totalPages = Math.max(1, Math.ceil(totalArticles / ARTICLES_PER_PAGE));
  const rawPage = typeof page === "number" && !Number.isNaN(page) ? page : 1;
  const currentPage = Math.min(Math.max(1, rawPage), totalPages);
  const start = (currentPage - 1) * ARTICLES_PER_PAGE;
  const items = articles.slice(start, start + ARTICLES_PER_PAGE);
  return {
    items,
    meta: {
      currentPage,
      totalPages,
      totalArticles,
      hasNext: currentPage < totalPages,
      hasPrev: currentPage > 1,
    },
  };
}

export function getRelatedArticles(
  article: BlogArticle,
  all: BlogArticle[],
  limit = 3,
): BlogArticle[] {
  return all
    .filter((a) => a.slug !== article.slug)
    .map((a) => ({
      article: a,
      sharedTags: a.tags.filter((t) => article.tags.includes(t)).length,
    }))
    .filter((x) => x.sharedTags > 0)
    .sort((a, b) => b.sharedTags - a.sharedTags)
    .slice(0, limit)
    .map((x) => x.article);
}

export function getTagCounts(
  articles: BlogArticle[],
): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of articles) {
    for (const t of a.tags) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

export function filterByTag(
  articles: BlogArticle[],
  tag: string,
): BlogArticle[] {
  return articles.filter((a) => a.tags.includes(tag));
}

export function generateBlogIndexMarkdown(): string {
  const lines = BLOG_ARTICLES.map(
    (a) => `- [${a.title}](${BASE_URL_FOR_MD}/blog/${a.slug}) — ${a.description}\n  - HTML: ${BASE_URL_FOR_MD}/blog/${a.slug}\n  - Markdown: ${BASE_URL_FOR_MD}/blog/${a.slug}.md\n  - Published: ${a.date}`,
  ).join("\n\n");

  return `# AgentBadge Blog — Article Index\n\n> Canonical: ${BASE_URL_FOR_MD}/blog\n\n${lines}\n`;
}
