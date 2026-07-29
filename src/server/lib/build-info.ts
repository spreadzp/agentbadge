/**
 * Build-time freshness constants (SLICE-18-11).
 *
 * Single source of truth for all freshness signals: sitemap lastmod,
 * JSON-LD dateModified, dashboard "as of" timestamp.
 *
 * Fly.io injects SOURCE_COMMIT automatically; BUILD_DATE is set at
 * deploy time via Dockerfile build arg.
 */

export const BUILD_DATE =
  process.env.BUILD_DATE ?? new Date().toISOString().slice(0, 10); // YYYY-MM-DD

export const GIT_COMMIT = process.env.SOURCE_COMMIT ?? "dev";
