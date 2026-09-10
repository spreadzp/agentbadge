/**
 * SLICE-101-7: Knowledge Profile Endpoint.
 *
 * GET /api/profile/:domain — returns KnowledgeProfile JSON
 * GET /api/profile/:domain?format=markdown — returns markdown
 * GET /api/profile/:domain?format=yaml — returns YAML
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { buildProfile } from "../../agent-readiness/profile/profile-builder";
import { renderProfileMarkdown } from "../../agent-readiness/profile/renderers/markdown-renderer";
import { renderProfileYaml } from "../../agent-readiness/profile/renderers/yaml-renderer";
import { getLatestScanForDomain, normalizeDomain } from "../profile/profile-store";

export const profileRoutes = new Hono();

profileRoutes.get(
  "/api/profile/:domain",
  describeRoute({
    description: "Get the Knowledge Profile for a scanned domain",
    responses: {
      200: { description: "Knowledge Profile in JSON, Markdown, or YAML format" },
      404: { description: "Domain has never been scanned" },
      503: { description: "Profile generation error" },
    },
  }),
  async (c) => {
    const rawDomain = c.req.param("domain");
    const format = c.req.query("format") ?? "json";
    const normalized = normalizeDomain(rawDomain);

    try {
      const scanData = await getLatestScanForDomain(normalized);

      if (!scanData) {
        return c.json({ error: "Domain has not been scanned", domain: normalized }, 404);
      }

      const profile = buildProfile({
        scanReport: scanData.scanReport,
        assertions: scanData.assertions,
        scoreResult: scanData.scoreResult,
        reportId: scanData.reportId,
      });

      if (format === "markdown") {
        const md = renderProfileMarkdown(profile);
        return c.text(md, 200, {
          "Content-Type": "text/markdown; charset=utf-8",
          "Cache-Control": "public, max-age=300",
        });
      }

      if (format === "yaml") {
        const yaml = renderProfileYaml(profile);
        return c.text(yaml, 200, {
          "Content-Type": "text/yaml; charset=utf-8",
          "Cache-Control": "public, max-age=300",
        });
      }

      // Default: JSON
      return c.json(profile, 200, {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      });
    } catch (err) {
      return c.json({ error: "Profile generation failed", detail: String(err) }, 503);
    }
  },
);
