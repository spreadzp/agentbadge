/**
 * SLICE-180-2 (EPIC-180): /verify SSR page — human-facing verdict
 * verification. One input accepts verdictId / txHash / memoId (all
 * 0x+64hex; resolveVerdictInput disambiguates). Three views:
 * form-only, result, honest not-found. No JS required — GET ?q= and
 * urlencoded POST both render the same result.
 */

import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { VerifyPage } from "../../views/verify-page";
import {
  lookupVerdict,
  resolveVerdictInput,
  type VerifyLookupDeps,
} from "../lib/verify/lookup";
import { consumerKey, createRateLimiter } from "../lib/eaas/request";

export interface VerifyPageDeps extends VerifyLookupDeps {
  rateRpm: number;
}

export function createVerifyPageRoutes(deps: VerifyPageDeps): Hono {
  const routes = new Hono();
  const limiter = createRateLimiter(deps.rateRpm);

  // Rate-limit check split from render so POST can gate before the
  // body parse (180-6 M-6) without double-counting a request.
  const rateLimited = (c: Context) =>
    !limiter.allow(`verify-page:${consumerKey(c)}`);

  const renderBody = (c: Context, query: string | undefined) => {
    if (!query) return c.html(VerifyPage({}));
    const resolved = resolveVerdictInput(query, deps);
    if (!resolved.ok) {
      const status = resolved.reason === "not_found" ? 404 : 200;
      return c.html(
        VerifyPage({ query, error: resolved.reason }),
        status,
      );
    }
    const result = lookupVerdict(resolved.verdictId, deps);
    if (!result) {
      // Resolved to a verdictId the store no longer serves — treat as
      // not-found rather than a 500 (anchor row without a verdict).
      return c.html(VerifyPage({ query, error: "not_found" }), 404);
    }
    return c.html(
      VerifyPage({ query, result, via: resolved.via }),
    );
  };

  routes.get(
    "/verify",
    describeRoute({
      description:
        "Verdict verification page — SSR form + result. Accepts ?q= of " +
        "verdictId / anchor txHash / memoId; POST urlencoded for non-JS.",
      responses: {
        200: { description: "HTML page (form, result, or malformed hint)" },
        404: { description: "Honest not-found view" },
        429: { description: "Rate limit exceeded" },
      },
    }),
    (c) =>
      rateLimited(c)
        ? c.text("rate limit exceeded", 429)
        : renderBody(c, c.req.query("q")),
  );

  routes.get(
    "/verify/:id",
    describeRoute({
      description: "Deep link to a verdict verification result.",
      responses: {
        200: { description: "HTML result" },
        404: { description: "Honest not-found view" },
        429: { description: "Rate limit exceeded" },
      },
    }),
    (c) =>
      rateLimited(c)
        ? c.text("rate limit exceeded", 429)
        : renderBody(c, c.req.param("id")),
  );

  routes.post("/verify", async (c) => {
    // 180-6 M-6: gate BEFORE parseBody — an oversized urlencoded body
    // must not be read into memory past the rate-limit check.
    if (rateLimited(c)) return c.text("rate limit exceeded", 429);
    const body = (await c.req.parseBody().catch(() => ({}))) as {
      q?: unknown;
    };
    const q = typeof body.q === "string" ? body.q : undefined;
    return renderBody(c, q);
  });

  return routes;
}
