import { Hono, type Context } from "hono";
import { getRegistry } from "../../registry/loader";
import type { RegistryIndex } from "../../registry/types";
import {
  generateCapabilitiesMarkdown,
  generateTeamOverviewMarkdown,
  generateServicesMarkdown,
  generateAvailabilityMarkdown,
  generateContactMarkdown,
  generateMatchMarkdown,
} from "../../registry/markdown";
import { ErrorCodes } from "../../lib/error-codes";
import { errorResponse } from "../../lib/error-response";

export const teamRoutes = new Hono();

teamRoutes.get("/agent-guide/team/capabilities.json", async (c) => {
  try {
    const registry = await getRegistry();
    return c.json(registry, 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    });
  } catch {
    return errorResponse(
      c,
      500,
      ErrorCodes.INTERNAL_ERROR,
      "Failed to load capability registry",
    );
  }
});

teamRoutes.get("/agent-guide/team/capabilities", async (c) => {
  try {
    const registry = await getRegistry();
    const markdown = generateCapabilitiesMarkdown(registry);
    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return errorResponse(
      c,
      500,
      ErrorCodes.INTERNAL_ERROR,
      "Failed to generate capabilities markdown",
    );
  }
});

async function serveMarkdown(
  c: Context,
  generator: (registry: RegistryIndex) => string,
  errorMsg: string,
): Promise<Response> {
  try {
    const registry = await getRegistry();
    const markdown = generator(registry);
    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR, errorMsg);
  }
}

teamRoutes.get("/agent-guide/team", (c) =>
  serveMarkdown(c, generateTeamOverviewMarkdown, "Failed to generate team overview"),
);

teamRoutes.get("/agent-guide/team/services", (c) =>
  serveMarkdown(c, generateServicesMarkdown, "Failed to generate services"),
);

teamRoutes.get("/agent-guide/team/availability", (c) =>
  serveMarkdown(c, generateAvailabilityMarkdown, "Failed to generate availability"),
);

teamRoutes.get("/agent-guide/team/contact", (c) =>
  serveMarkdown(c, generateContactMarkdown, "Failed to generate contact info"),
);

teamRoutes.get("/agent-guide/team/match", (c) =>
  serveMarkdown(c, generateMatchMarkdown, "Failed to generate match criteria"),
);
