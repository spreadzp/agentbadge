// EPIC-146 (SLICE-146-7): shared helpers + regexes for GEO citability
// checkers — ported from packages/agent-readiness-scanner.
// Keep in sync with the core package implementation.

export const QUESTION_WORD_RE =
  /^(how|what|why|when|where|which|who|whom|whose|can|could|does|do|is|are|should|will|would)\b/i;
export const PRONOUN_START_RE = /^(it|this|that|they|these|those|he|she|its)\b/i;
export const REFERENCE_BACK_RE =
  /\bas (mentioned|discussed|noted|described) (above|earlier|previously)\b/i;
export const CTA_ONLY_RE =
  /\b(sign up|get started|learn more|contact us|buy now|try (it|now|free)|subscribe|read more|click here|book a demo)\b/i;
export const ANSWER_MIN_WORDS = 80;
export const ANSWER_MAX_WORDS = 200;
export const MIN_PAGE_WORDS = 300;

export const SOURCE_MARKER_RE =
  /\b(according to|per\s+[A-Z]|source[d]?:|via\s+[A-Z]|data from|study (by|from)|report (by|from)|survey (by|of|from)|research (by|from)|published by|measured (by|in))\b/gi;
export const DATE_TOKEN_RE =
  /\b(20\d{2}|19\d{2}|Q[1-4]\s*20\d{2}|(January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2})\b/gi;
export const SUPERLATIVE_RE =
  /\b(best[- ]in[- ]class|industry[- ]leading|the leading (platform|service|tool|provider|solution)|world[- ]class|cutting[- ]edge|state[- ]of[- ]the[- ]art)\b/gi;

export const ABOUT_LINK_RE =
  /<a[^>]+href=["'][^"']*(?:\/about(?:-us)?|\/company|\/who-we-are)\b/i;
export const CATEGORY_STATEMENT_RE =
  /\b[A-Z][\w'&.-]{0,30}\s+(?:is|are)\s+(?:a|an|the)\s+[\w][\w'& ,.-]{2,120}?(?:for|to)\s+|\b[A-Z][\w'&.-]{0,30}\s+helps\s+[\w]/;
export const JSONLD_BLOCK_RE =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
export const ENTITY_TYPES = new Set([
  "organization", "website", "product", "aboutpage", "brand",
]);

export const SSR_MIN_WORDS = 150;
export const SSR_THIN_WORDS = 80;
export const MOUNT_SHELL_RE =
  /<div[^>]+id=["'](?:root|app|__next|__nuxt|__svelte|ember-app)["'][^>]*>\s*(?:<!--[\s\S]*?-->\s*)*<\/div>/i;
export const SCRIPT_SRC_RE = /<script[^>]+src=["'][^"']+["']/gi;

export const OVERLAY_RE =
  /(?:class|id)=["'][^"']*\b(?:modal|popup|interstitial|cookie[-_ ]?(?:consent|banner|wall)|newsletter[-_ ]?popup)\b[^"']*["']|role=["'](?:alert)?dialog["']|style=["'][^"']*position:\s*fixed[^"']*(?:inset:\s*0|(?:width|height):\s*100v[wh]|z-index:\s*\d{3,})/i;
export const CTA_TAG_RE =
  /<button[\s>]|<a[^>]+class=["'][^"']*\b(?:cta|btn|button)[\w-]*\b/gi;
export const AUTHOR_SIGNAL_RE =
  /rel=["']author["']|<meta[^>]+name=["']author["']|["']author["']\s*:|class=["'][^"']*\bauthor\b|itemprop=["']author["']/i;
export const DATE_SIGNAL_RE =
  /<time[^>]+datetime=["']|["']datePublished["']\s*:|article:published_time|itemprop=["']datePublished["']/i;
export const ARTICLE_HINT_RE =
  /<article[\s>]|["']@type["']\s*:\s*["'](?:Article|BlogPosting|NewsArticle|TechArticle|Report)["']/i;

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(text: string): number {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

export interface QuestionHeading {
  text: string;
  endIndex: number;
}

export function extractQuestionHeadings(html: string): QuestionHeading[] {
  const re = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
  const out: QuestionHeading[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = htmlToText(m[1]);
    if (!text) continue;
    if (text.endsWith("?") || QUESTION_WORD_RE.test(text)) {
      out.push({ text, endIndex: m.index + m[0].length });
    }
  }
  return out;
}

export function extractAnswerBlock(html: string, fromIndex: number): string {
  const rest = html.slice(fromIndex);
  const nextHeading = rest.search(/<h[1-6][\s>]/i);
  const segment =
    nextHeading === -1 ? rest.slice(0, 4000) : rest.slice(0, nextHeading);
  const pMatch = segment.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  const raw = pMatch ? pMatch[1] : segment;
  return htmlToText(raw);
}

/** True when a digit appears within `window` chars after `index`. */
export function numberNearby(text: string, index: number, window = 140): boolean {
  return /\d/.test(text.slice(index, index + window));
}

export function normalizeEntityName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[\u2013\u2014|·•:]/g, "|")
    .split("|")[0]
    .replace(/[^a-z0-9&' ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface JsonLdEntity {
  name?: string;
  hasDescription: boolean;
}

/** Walk parsed JSON-LD (incl. @graph, arrays) → entity-ish objects. */
export function collectJsonLdEntities(node: unknown, out: JsonLdEntity[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectJsonLdEntities(item, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj["@graph"])) {
    for (const item of obj["@graph"]) collectJsonLdEntities(item, out);
  }
  const types = ([] as unknown[]).concat(obj["@type"] ?? []);
  if (types.some((t) => ENTITY_TYPES.has(String(t).toLowerCase()))) {
    out.push({
      name: typeof obj.name === "string" ? obj.name : undefined,
      hasDescription:
        typeof obj.description === "string" && obj.description.length > 30,
    });
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") collectJsonLdEntities(v, out);
  }
}

export function extractMetaContent(html: string, key: string, attr: "property" | "name"): string | null {
  const re1 = new RegExp(
    `<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']+)`, "i");
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${key}["']`, "i");
  return re1.exec(html)?.[1] ?? re2.exec(html)?.[1] ?? null;
}
