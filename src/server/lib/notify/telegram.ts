/**
 * SLICE-203-12: Telegram Bot API sender.
 *
 * Reusable `sendMessage` wrapper (parse_mode=HTML). Credentials come from
 * TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID — same env names as the article
 * announcer in docs/ARTICLES/content-plan/round-2/WORKING-SMI/TELEGRAM.
 * Graceful: telegramFromEnv() returns undefined when creds are absent so
 * callers can skip notification instead of crashing.
 */

export type TelegramConfig = {
  token: string;
  chatId: string;
};

/** Escape &, <, > for parse_mode=HTML payloads. */
export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Read bot credentials from env; undefined when either var is missing. */
export function telegramFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TelegramConfig | undefined {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return undefined;
  return { token, chatId };
}

/**
 * Send one message via Bot API sendMessage.
 * Returns message_id on ok=true; throws with the API description on ok=false.
 */
export async function sendTelegramMessage(
  text: string,
  cfg: TelegramConfig,
): Promise<number> {
  const res = await fetch(
    `https://api.telegram.org/bot${cfg.token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cfg.chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    },
  );
  const data = (await res.json()) as {
    ok: boolean;
    result?: { message_id?: number };
    description?: string;
  };
  if (!data.ok) {
    throw new Error(
      `telegram sendMessage failed: ${data.description ?? res.status}`,
    );
  }
  return data.result?.message_id ?? 0;
}

/** Bot API sendDocument hard limit is 50MB; warn past 45MB. */
export const TELEGRAM_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;
const WARN_BYTES = 45 * 1024 * 1024;

export type TelegramDocument = {
  /** Required — without a filename TG treats the upload as nameless binary. */
  filename: string;
  /** Raw bytes or text; sent as-is via multipart, never re-encoded/base64. */
  data: Uint8Array | string;
  /** Plain-text caption (≤1024 chars). Escaped via escHtml, sent as HTML. */
  caption?: string;
  /** Blob MIME type; defaults to octet-stream / text/plain by data type. */
  mimeType?: string;
  disableNotification?: boolean;
};

/**
 * Send one file via Bot API sendDocument (multipart/form-data).
 * Returns message_id on ok=true; throws with the API description on ok=false.
 * Caller guarantees size ≤ 50MB — a >45MB payload logs a warning.
 */
export async function sendTelegramDocument(
  cfg: TelegramConfig,
  doc: TelegramDocument,
): Promise<number> {
  const byteLength =
    typeof doc.data === "string" ? Buffer.byteLength(doc.data) : doc.data.byteLength;
  if (byteLength > WARN_BYTES) {
    console.warn(
      `telegram sendDocument: ${doc.filename} is ${byteLength} bytes (>45MB, TG limit 50MB)`,
    );
  }

  const form = new FormData();
  form.append("chat_id", cfg.chatId);
  const blob =
    typeof doc.data === "string"
      ? new Blob([doc.data], { type: doc.mimeType ?? "text/plain" })
      : new Blob([doc.data as BlobPart], {
          type: doc.mimeType ?? "application/octet-stream",
        });
  form.append("document", blob, doc.filename);
  if (doc.caption) {
    form.append("caption", escHtml(doc.caption));
    form.append("parse_mode", "HTML");
  }
  if (doc.disableNotification) {
    form.append("disable_notification", "true");
  }

  const res = await fetch(
    `https://api.telegram.org/bot${cfg.token}/sendDocument`,
    { method: "POST", body: form },
  );
  const data = (await res.json()) as {
    ok: boolean;
    result?: { message_id?: number };
    description?: string;
  };
  if (!data.ok) {
    throw new Error(
      `telegram sendDocument failed: ${data.description ?? res.status}`,
    );
  }
  return data.result?.message_id ?? 0;
}
