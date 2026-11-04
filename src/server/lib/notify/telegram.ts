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
