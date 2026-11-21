/**
 * EPIC-228 (SLICE-228-6, D-228-9): domain wiring —
 * mounts the three interaction surfaces (public API, admin API,
 * admin SSR) via routes/agent-interaction/mount.ts and registers
 * the Telegram notify hook on `interaction.request.received`.
 *
 * The hook rides the post-commit event seam (lib/agent-interaction
 * events.ts): fires only AFTER the request row committed, is
 * fire-and-forget — a TG failure logs a warning, never fails the
 * intake. Missing TELEGRAM_BOT_TOKEN/CHAT_ID → graceful no-op.
 */

import type { Hono } from "hono";
import { logger } from "@agentbadge/passport/logger";

import {
  escHtml,
  sendTelegramMessage,
  telegramFromEnv,
} from "../lib/notify/telegram";
import { onInteractionEvent } from "../lib/agent-interaction/events";
import { mountAgentInteractionRoutes } from "../routes/agent-interaction/mount";
import type { RequestInboxStores } from "../lib/request-inbox/store";
import type { RequestInboxEnvConfig } from "../../config/env/types";

const ADMIN_BASE = "https://agentbadge.xyz/admin/interactions";

function notifyInteractionReceived(
  requestId: string,
  payload: Record<string, unknown>,
): void {
  const cfg = telegramFromEnv();
  if (!cfg) return; // TG-off → no-op, never a failure mode
  const lines = [
    `<b>New agent request</b> ${escHtml(requestId)}`,
    `actor: ${escHtml(String(payload.actorResolution ?? "ANON"))} · channel: ${escHtml(String(payload.channel ?? "rest"))}`,
  ];
  const excerpt = payload.excerpt;
  if (typeof excerpt === "string" && excerpt.length > 0) {
    // Arc-audit M10: newlines + bidi/control chars let a submitter
    // inject fake operator-looking lines into the operator channel —
    // collapse whitespace and drop non-printing chars before escHtml.
    const clean = excerpt
      .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    if (clean.length > 0) lines.push(escHtml(clean));
  }
  lines.push(`<a href="${ADMIN_BASE}/${escHtml(requestId)}">open in inbox</a>`);
  sendTelegramMessage(lines.join("\n"), cfg).catch((err) => {
    logger.warn("agent-interaction: tg notify failed", {
      requestId,
      err: err instanceof Error ? err.message : String(err),
    });
  });
}

let hookRegistered = false;

export function wireAgentInteraction(
  app: Hono,
  stores: RequestInboxStores,
  env: RequestInboxEnvConfig,
): void {
  mountAgentInteractionRoutes(app, stores, env);
  if (hookRegistered) return; // single hook per process (tests remount)
  hookRegistered = true;
  onInteractionEvent((_requestId, event) => {
    if (
      event.kind === "interaction.request.received" &&
      event.visibility === "PUBLIC"
    ) {
      notifyInteractionReceived(
        _requestId,
        (event.payload ?? {}) as Record<string, unknown>,
      );
    }
  });
}
