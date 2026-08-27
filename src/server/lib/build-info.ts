/**
 * Build-time freshness constants (SLICE-18-11, SLICE-88-6).
 *
 * Single source of truth for all freshness signals: sitemap lastmod,
 * JSON-LD dateModified, dashboard "as of" timestamp, and app version.
 *
 * Fly.io injects SOURCE_COMMIT automatically; BUILD_DATE is set at
 * deploy time via Dockerfile build arg. APP_VERSION is injected via
 * Dockerfile build arg from package.json, or read from package.json
 * directly as fallback.
 *
 * NOTE: Uses `||` instead of `??` because Dockerfile ENV sets empty
 * string when build-arg is not passed (e.g. bare `fly deploy`).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readPkgVersion(): string {
  try {
    const pkgPath = resolve(process.cwd(), "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const BUILD_DATE =
  process.env.BUILD_DATE || new Date().toISOString().slice(0, 10); // YYYY-MM-DD

export const GIT_COMMIT = process.env.SOURCE_COMMIT || "dev";

export const APP_VERSION = process.env.APP_VERSION || readPkgVersion();
