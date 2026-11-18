import { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { adminAuth } from "../../middleware/adminAuth";
import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import { telegramFromEnv } from "../../lib/notify/telegram";
import { sendInboxDigest } from "../../lib/request-inbox/tg-digest";
import type { RequestInboxStores } from "../../lib/request-inbox/store";

/**
 * EPIC-252: on-demand inbox TG digest - manual trigger only.
 * The hourly auto-ticker stays env-gated; ops pulls this when they
 * want a queue snapshot in the chat instead of waiting for the tick.
 */

export interface InboxOpsDigestDeps {
  stores: RequestInboxStores;
}

export function createInboxOpsDigestRoutes(deps: InboxOpsDigestDeps): Hono {
  const app = new Hono();
  const { stores } = deps;

  app.post(
    "/api/ops/requests/digest",
    adminAuth,
    describeRoute({
      summary: "Send the inbox digest to Telegram now (on-demand, ignores watermark)",
      tags: ["Ops"],
      responses: {
        200: { description: "Digest sent (or skipped: 0 new / no creds)" },
        401: { description: "Admin key required" },
      },
    }),
    async (c) => {
      const cfg = telegramFromEnv();
      const r = await sendInboxDigest({
        stores,
        cfg: cfg ?? undefined,
        sinceMs: 0,
        limit: 50,
      });
      if (!r.sent && !cfg) {
        return errorResponse(
          c,
          503,
          ErrorCodes.INTERNAL_ERROR,
          "telegram creds not configured",
        );
      }
      return c.json({ sent: r.sent, count: r.count });
    },
  );

  return app;
}
