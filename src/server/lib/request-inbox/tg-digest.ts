import { logger } from "@agentbadge/passport/logger";

import { escHtml, sendTelegramMessage } from "../notify/telegram";
import type { TelegramConfig } from "../notify/telegram";
import { payloadQuestionText } from "./qa";
import type { RequestInboxStores } from "./store";
import type { InboxRequestRecord } from "./types";

/**
 * EPIC-252 (SLICE-252-3, D-252-Q3): one-way batched TG digest —
 * «N новых запросов + топ-K кейсов» в ops-чат. NEVER a write path:
 * no replies, no request mutation. Graceful no-op without creds.
 */

export interface DigestItem {
  id: string;
  kind: string | null;
  question: string;
  verified: boolean;
}

const QUESTION_MAX = 120;

export function buildDigestMessage(
  items: DigestItem[],
  opts: { total: number },
): string {
  const lines = [`📥 <b>${opts.total}</b> new agent request(s)`];
  for (const it of items) {
    const q = it.question.replace(/\s+/g, " ").trim();
    const short = q.length > QUESTION_MAX ? `${q.slice(0, QUESTION_MAX)}…` : q;
    const badge = it.verified ? " ✅" : "";
    const kind = it.kind ? ` [${it.kind}]` : "";
    lines.push(`• <code>${escHtml(it.id)}</code>${escHtml(kind)}${badge} ${escHtml(short)}`);
  }
  return lines.join("\n");
}

export interface InboxDigestOpts {
  stores: RequestInboxStores;
  /** Undefined → graceful skip (no creds configured). */
  cfg?: TelegramConfig;
  topK?: number;
  sinceMs?: number;
  limit?: number;
  /** Injectable sender for tests; defaults to real Bot API call. */
  send?: (text: string, cfg: TelegramConfig) => Promise<number>;
}

const toItem = (r: InboxRequestRecord): DigestItem => ({
  id: r.id,
  kind: r.kind,
  question: payloadQuestionText(r.payload) ?? "(no question)",
  verified: r.verified,
});

export async function sendInboxDigest(opts: InboxDigestOpts): Promise<{
  sent: boolean;
  count: number;
}> {
  const { stores, cfg } = opts;
  if (!cfg) {
    logger.info("request-inbox digest: no TELEGRAM creds — skipped");
    return { sent: false, count: 0 };
  }
  const records = await stores.requests.listByState({
    state: "submitted",
    sinceMs: opts.sinceMs,
    limit: opts.limit ?? 50,
  });
  if (records.length === 0) {
    return { sent: false, count: 0 };
  }
  const send = opts.send ?? sendTelegramMessage;
  const topK = opts.topK ?? 5;
  const text = buildDigestMessage(
    records.slice(0, topK).map(toItem),
    { total: records.length },
  );
  await send(text, cfg);
  return { sent: true, count: records.length };
}
