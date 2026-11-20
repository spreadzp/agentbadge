import type { KnowledgeStore } from "./store";

/**
 * EPIC-229 (SLICE-229-2, D-229-1): slug validation/generation.
 * Slugs are the public identifier — stable, URL-safe, operator-owned.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,120}$/;
const MAX_SLUG = 121; // 1 + 120

export function isValidKnowledgeSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/**
 * Derive a candidate slug from a title: lowercase, non-alnum runs →
 * single dash, trimmed. Returns null when nothing usable remains
 * (caller falls back to a generated id-slug).
 */
export function slugifyTitle(title: string): string | null {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, "");
  return SLUG_RE.test(s) ? s : null;
}

/** `slug`, `slug-2`, `slug-3`… until free. */
export async function ensureUniqueSlug(
  store: KnowledgeStore,
  base: string,
): Promise<string> {
  if (!SLUG_RE.test(base)) {
    throw new KnowledgeSlugError("invalid_slug", base);
  }
  if ((await store.getItemBySlug(base)) === null) return base;
  for (let i = 2; i < 1000; i += 1) {
    const suffix = `-${i}`;
    const candidate = `${base.slice(0, MAX_SLUG - suffix.length)}${suffix}`;
    if ((await store.getItemBySlug(candidate)) === null) return candidate;
  }
  throw new KnowledgeSlugError("slug_space_exhausted", base);
}

export class KnowledgeSlugError extends Error {
  constructor(
    readonly code: "invalid_slug" | "slug_space_exhausted" | "slug_taken",
    slug: string,
  ) {
    super(`knowledge slug ${code}: ${slug}`);
    this.name = "KnowledgeSlugError";
  }
}
