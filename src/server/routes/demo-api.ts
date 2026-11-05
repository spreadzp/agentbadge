/**
 * SLICE-206-15 (EPIC-206): GET /api/v1/demo/scan-lite — the $0.001
 * "try us" x402-gated one-page probe.
 *
 * The route itself is intentionally thin: query validation → SSRF-safe
 * target → runScanLite → shaped JSON. The payment gate lives in
 * wiring/demo-x402.ts (paymentForPrice before this mount — Hono
 * composes in registration order, keep it there).
 */
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import {
  runScanLite,
  validateTarget,
  demoScanPriceUsd,
  type ScanLiteReject,
} from "../lib/demo-scan";

export const demoApiRoutes = new Hono();

function rejectStatus(r: ScanLiteReject): { status: 400 | 502; error: string } {
  switch (r) {
    case "invalid_url":
      return { status: 400, error: "url must be a valid http(s) URL" };
    case "blocked_host":
      return {
        status: 400,
        error:
          "url points at a private, loopback, link-local or internal host",
      };
    case "dns_private":
      return {
        status: 400,
        error: "url hostname resolves to a private/internal address",
      };
    case "too_many_redirects":
      return { status: 502, error: "redirect chain longer than 3 hops" };
    case "not_html":
      return { status: 502, error: "target did not return an HTML page" };
    case "fetch_failed":
      return { status: 502, error: "fetch failed or timed out (8s budget)" };
  }
}

demoApiRoutes.get(
  "/api/v1/demo/scan-lite",
  describeRoute({
    tags: ["Demo"],
    summary: "One-page agent-readiness teaser (x402, ~$0.001)",
    description:
      "Paid micro-scan: fetches ?url and returns og/meta plus " +
      "agent-signals (llms.txt link, JSON-LD, robots meta, agents.txt, " +
      "content-negotiation hint). The cheapest way to see a real " +
      "x402 payment → result roundtrip on Arc.",
    responses: {
      200: { description: "Mini-scan result" },
      400: { description: "Missing/invalid url or blocked host" },
      402: { description: "x402 payment required" },
      502: { description: "Target fetch failed or returned non-HTML" },
    },
  }),
  async (c) => {
    const raw = c.req.query("url");
    if (!raw) {
      return c.json(
        { error: "missing required query param: url", code: "MISSING_URL" },
        400,
      );
    }
    // Pre-paywall stash (audit H — charged-on-failure + DNS pin): when
    // the wiring precheck already resolved+validated the target, reuse
    // it and pin the connection to those addresses.
    const stashed = c.get("scanLitePrecheck");
    if (stashed) {
      const stashedResult = await runScanLite(stashed.url, {
        pinned: stashed.addrs,
      });
      if (typeof stashedResult === "string") {
        const { status, error } = rejectStatus(stashedResult);
        return c.json({ error, code: stashedResult.toUpperCase() }, status);
      }
      return c.json({
        scan: "lite",
        price_usdc: demoScanPriceUsd(),
        ...stashedResult,
        upgrade: {
          full_scan: "/api/scan-packs (x402)",
          pricing: "/pricing.json",
        },
      });
    }
    const target = validateTarget(raw);
    if (!(target instanceof URL)) {
      const { status, error } = rejectStatus(target);
      return c.json({ error, code: target.toUpperCase() }, status);
    }

    const result = await runScanLite(target);
    if (typeof result === "string") {
      const { status, error } = rejectStatus(result);
      return c.json({ error, code: result.toUpperCase() }, status);
    }

    return c.json({
      scan: "lite",
      price_usdc: demoScanPriceUsd(),
      ...result,
      upgrade: {
        full_scan: "/api/scan-packs (x402)",
        pricing: "/pricing.json",
      },
    });
  },
);
