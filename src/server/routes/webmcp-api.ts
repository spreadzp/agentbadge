/**
 * WebMCP API routes — lightweight endpoints for WebMCP tools.
 *
 * SLICE-91-9: Additional tools endpoints.
 *
 * GET /scan             — full agent readiness scan report for a URL
 * GET /badge            — generate compliance badge SVG for a URL
 * GET /passport/verify  — verify passport by tokenId or DID
 * GET /score            — quick compliance score for a URL
 * GET /rules/search     — search agent readiness rules catalog
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { getPassportInfo } from "@agentbadge/passport";
import { isEvmDid, parseEvmDid } from "@agentbadge/evm-core";
import { parseDid } from "./did";
import { getChainAdapter } from "../lib/chain-adapter-factory";
import { RULE_DESCRIPTIONS } from "../../agent-readiness/rule-descriptions";
import { scanDomain } from "../../agent-readiness/scanner/orchestrator";
import { RuleEngine } from "../../agent-readiness/rule-engine/rule-engine";
import { formatScanReport } from "../../agent-readiness/report-formatter";
import { assertSafeTarget } from "../../agent-readiness/scanner/ssrf/ip-guard";

export const webmcpApiRoutes = new Hono();

// ─── GET /passport/verify ──────────────────────────────────────────
webmcpApiRoutes.get(
  "/passport/verify",
  describeRoute({
    tags: ["WebMCP"],
    summary: "Verify an AgentBadge passport NFT by tokenId or DID",
    responses: {
      200: { description: "Passport verification result" },
      400: { description: "Missing tokenId or did" },
      404: { description: "Passport not found" },
    },
  }),
  async (c) => {
    const tokenId = c.req.query("tokenId");
    const did = c.req.query("did");

    if (!tokenId && !did) {
      return c.json({ error: "Either tokenId or did query parameter is required" }, 400);
    }

    let resolvedTokenId = tokenId;
    let serial = 0;

    try {
      if (did) {
        if (isEvmDid(did)) {
          const parsed = parseEvmDid(did);
          if (!parsed) {
            return c.json({ error: "Invalid DID format" }, 400);
          }
          const adapter = await getChainAdapter();
          const passport = await adapter.getPassportInfo(parsed.nftAddress, parsed.tokenId);
          if (!passport) {
            return c.json({ valid: false, error: "Passport not found" }, 404);
          }
          const evmInfo = passport as import("@agentbadge/evm-core").EvmPassportInfo;
          return c.json({
            valid: !evmInfo.deleted,
            owner: evmInfo.account_id,
            tier: evmInfo.passportType,
            issuedAt: evmInfo.created_timestamp,
            did,
          }, 200);
        }

        const parsed = parseDid(did);
        if (!parsed) {
          return c.json({ error: "Invalid DID format" }, 400);
        }
        resolvedTokenId = parsed.tokenId;
        serial = parsed.serial;
      }

      const info = await getPassportInfo(resolvedTokenId!, serial);
      if (!info) {
        return c.json({ valid: false, error: "Passport not found" }, 404);
      }
      return c.json({
        valid: info.active,
        owner: info.owner,
        tier: info.tier,
        issuedAt: info.issuedAt,
        did: info.did,
      }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ valid: false, error: `Verification failed: ${message}` }, 500);
    }
  },
);

// ─── GET /scan ─────────────────────────────────────────────────────
webmcpApiRoutes.get(
  "/scan",
  describeRoute({
    tags: ["WebMCP"],
    summary: "Full agent readiness scan for a URL — returns complete report with categories and missing rules",
    responses: {
      200: { description: "Full scan report" },
      400: { description: "Missing or invalid URL" },
      403: { description: "Private URLs are not allowed" },
    },
  }),
  async (c) => {
    const url = c.req.query("url");
    if (!url) {
      return c.json({ error: "URL is required" }, 400);
    }

    let normalizedUrl = url.trim();
    if (!normalizedUrl.match(/^https?:\/\//)) {
      normalizedUrl = "https://" + normalizedUrl;
    }

    try {
      new URL(normalizedUrl);
    } catch {
      return c.json({ error: `Invalid URL: ${normalizedUrl}` }, 400);
    }

    const hostname = new URL(normalizedUrl).hostname;
    try {
      assertSafeTarget(hostname);
    } catch {
      return c.json({ error: "Private URLs are not allowed" }, 403);
    }

    try {
      const sourceState = await scanDomain(normalizedUrl, {});
      const result = RuleEngine.run(sourceState);
      const report = formatScanReport(normalizedUrl, result);
      return c.json(report, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: `Scan failed: ${message}` }, 500);
    }
  },
);

// ─── GET /badge ────────────────────────────────────────────────────
webmcpApiRoutes.get(
  "/badge",
  describeRoute({
    tags: ["WebMCP"],
    summary: "Generate a compliance badge SVG for a URL based on live scan",
    responses: {
      200: { description: "SVG badge image" },
      400: { description: "Missing or invalid URL" },
      403: { description: "Private URLs are not allowed" },
    },
  }),
  async (c) => {
    const url = c.req.query("url");
    if (!url) {
      return c.json({ error: "URL is required" }, 400);
    }

    let normalizedUrl = url.trim();
    if (!normalizedUrl.match(/^https?:\/\//)) {
      normalizedUrl = "https://" + normalizedUrl;
    }

    try {
      new URL(normalizedUrl);
    } catch {
      return c.json({ error: `Invalid URL: ${normalizedUrl}` }, 400);
    }

    const hostname = new URL(normalizedUrl).hostname;
    try {
      assertSafeTarget(hostname);
    } catch {
      return c.json({ error: "Private URLs are not allowed" }, 403);
    }

    try {
      const sourceState = await scanDomain(normalizedUrl, {});
      const result = RuleEngine.run(sourceState);
      const report = formatScanReport(normalizedUrl, result);
      const { generateBadgeSvg } = await import("../../agent-readiness/badge/svg-generator");
      const svg = generateBadgeSvg({
        scope: hostname,
        score: report.score,
        rulesetVersion: "1.0.0",
        scannedAt: new Date().toISOString(),
        reportUrl: `https://agentbadge.xyz/r/${hostname}`,
        stale: false,
      });
      c.header("Content-Type", "image/svg+xml");
      c.header("Cache-Control", "public, max-age=3600");
      return c.body(svg);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: `Badge generation failed: ${message}` }, 500);
    }
  },
);

// ─── GET /score ────────────────────────────────────────────────────
webmcpApiRoutes.get(
  "/score",
  describeRoute({
    tags: ["WebMCP"],
    summary: "Get agent readiness compliance score for a URL",
    responses: {
      200: { description: "Compliance score" },
      400: { description: "Missing or invalid URL" },
    },
  }),
  async (c) => {
    const url = c.req.query("url");
    if (!url) {
      return c.json({ error: "URL is required" }, 400);
    }

    let normalizedUrl = url.trim();
    if (!normalizedUrl.match(/^https?:\/\//)) {
      normalizedUrl = "https://" + normalizedUrl;
    }

    try {
      new URL(normalizedUrl);
    } catch {
      return c.json({ error: `Invalid URL: ${normalizedUrl}` }, 400);
    }

    const hostname = new URL(normalizedUrl).hostname;
    try {
      assertSafeTarget(hostname);
    } catch {
      return c.json({ error: "Private URLs are not allowed" }, 403);
    }

    try {
      const sourceState = await scanDomain(normalizedUrl, {});
      const result = RuleEngine.run(sourceState);
      const report = formatScanReport(normalizedUrl, result);
      return c.json({
        score: report.score,
        grade: report.grade,
        summary: report.summary,
      }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: `Scan failed: ${message}` }, 500);
    }
  },
);

// ─── GET /rules/search ─────────────────────────────────────────────
webmcpApiRoutes.get(
  "/rules/search",
  describeRoute({
    tags: ["WebMCP"],
    summary: "Search agent readiness rules by query or category",
    responses: {
      200: { description: "Matching rules" },
    },
  }),
  (c) => {
    const q = c.req.query("q")?.toLowerCase().trim();
    const category = c.req.query("category")?.toLowerCase().trim();

    let rules = RULE_DESCRIPTIONS.map((r) => ({
      id: r.rule_id,
      title: r.title,
      category: r.category,
      short_description: r.short_description,
      effort_hint: r.effort_hint,
      estimated_cost: r.estimated_cost,
    }));

    if (category) {
      rules = rules.filter((r) => r.category === category);
    }

    if (q) {
      rules = rules.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q) ||
          r.short_description.toLowerCase().includes(q),
      );
    }

    return c.json({ rules }, 200);
  },
);
