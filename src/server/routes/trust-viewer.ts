/**
 * SLICE-102-9: Trust Viewer Route.
 *
 * GET /trust/:domain → HTML page rendering trust snapshot.
 */

import { Hono } from "hono";
import { TrustViewer, TrustViewerNotFound, TrustViewerError } from "../../views/trust-viewer";
import { verifySnapshot } from "../../agent-readiness/trust/snapshot-verifier";
import { fetchTrustSnapshot } from "../../agent-readiness/trust/trust-api-client";

export const trustViewerRoutes = new Hono();

trustViewerRoutes.get("/trust/:domain", async (c) => {
  const rawDomain = c.req.param("domain");
  const normalized = rawDomain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();

  try {
    let snapshot;
    try {
      snapshot = await fetchTrustSnapshot(normalized);
    } catch {
      return c.html(TrustViewerNotFound(normalized).toString(), 404);
    }

    let verificationResult;
    try {
      verificationResult = await verifySnapshot(snapshot, { skipOnChain: true });
    } catch {
      // If verification throws (e.g. missing public key), render without verification
    }

    const html = TrustViewer(snapshot, verificationResult);
    return c.html(html.toString(), 200, {
      "Cache-Control": "public, max-age=300",
    });
  } catch (err) {
    return c.html(TrustViewerError(normalized, String(err)).toString(), 500);
  }
});
