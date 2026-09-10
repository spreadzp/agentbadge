/**
 * SLICE-101-9: Profile Viewer Route.
 *
 * GET /profile/:domain → HTML page rendering the knowledge profile.
 */

import { Hono } from "hono";
import { ProfileViewer } from "../../views/profile-viewer";
import { getLatestScanForDomain, normalizeDomain } from "../profile/profile-store";
import { buildProfile } from "../../agent-readiness/profile/profile-builder";

export const profileViewerRoutes = new Hono();

profileViewerRoutes.get("/profile/:domain", async (c) => {
  const rawDomain = c.req.param("domain");
  const normalized = normalizeDomain(rawDomain);

  try {
    const scanData = await getLatestScanForDomain(normalized);

    if (!scanData) {
      return c.html(renderNotFound(normalized), 404);
    }

    const profile = buildProfile({
      scanReport: scanData.scanReport,
      assertions: scanData.assertions,
      scoreResult: scanData.scoreResult,
      reportId: scanData.reportId,
    });

    const html = ProfileViewer(profile);
    return c.html(html.toString(), 200, {
      "Cache-Control": "public, max-age=300",
    });
  } catch (err) {
    return c.html(renderError(normalized, String(err)), 503);
  }
});

function renderNotFound(domain: string): string {
  return `<!DOCTYPE html><html><head><title>Profile Not Found: ${domain}</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-slate-950 text-slate-300 min-h-screen flex items-center justify-center">
    <div class="text-center">
      <h1 class="text-2xl font-bold text-white mb-2">Profile Not Found</h1>
      <p class="text-slate-400">Domain <strong>${domain}</strong> has not been scanned yet.</p>
      <a href="/" class="mt-4 inline-block rounded-lg bg-slate-800 px-4 py-2 text-slate-300 hover:bg-slate-700">Back to Home</a>
    </div>
  </body></html>`;
}

function renderError(domain: string, error: string): string {
  return `<!DOCTYPE html><html><head><title>Profile Error: ${domain}</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-slate-950 text-slate-300 min-h-screen flex items-center justify-center">
    <div class="text-center">
      <h1 class="text-2xl font-bold text-white mb-2">Profile Generation Error</h1>
      <p class="text-slate-400">Failed to generate profile for <strong>${domain}</strong>.</p>
      <p class="text-red-400 text-sm mt-2">${error}</p>
    </div>
  </body></html>`;
}
