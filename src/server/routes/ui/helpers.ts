// EPIC-140 (SLICE-140-15): shared UI helpers extracted from routes/ui.ts.
import { type Context } from "hono";
import { Layout } from "../../../views/layout";
import { type PageMeta } from "../../lib/page-meta";

/** Check if request is from HTMX (partial) vs direct browser access (full page). */
export function isHtmxRequest(c: Context): boolean {
  return c.req.header("HX-Request") === "true";
}

/** Wrap fragment in full Layout for direct access, or return bare fragment for HTMX. */
export function wrapFragment(c: Context, fragment: string, title?: string, meta?: PageMeta, jsonLd?: object[]): string {
  return isHtmxRequest(c) ? fragment : Layout(fragment, title, meta, jsonLd, true).toString();
}
