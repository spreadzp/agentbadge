export interface ContactInput {
  channel: "discord" | "telegram";
  message: string;
  contactInfo?: string;
  fileName?: string;
  fileContent?: string;
}

export interface DiscordMessageOpts {
  message: string;
  contactInfo?: string;
  fileName?: string;
  fileContent?: string;
}

export interface TelegramMessageOpts {
  message: string;
  contactInfo?: string;
}

export function formatFeedbackMessage(input: ContactInput): string {
  const timestamp = new Date().toISOString();
  const lines = [
    `📨 New Feedback (${input.channel.toUpperCase()})`,
    `Time: ${timestamp}`,
    ``,
    `Message:`,
    input.message,
  ];
  if (input.contactInfo) {
    lines.push(``, `Contact: ${input.contactInfo}`);
  }
  if (input.fileName) {
    lines.push(``, `Attachment: ${input.fileName}`);
  }
  return lines.join("\n");
}

export async function sendDiscordMessage(opts: DiscordMessageOpts): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("DISCORD_WEBHOOK_URL not configured");

  const content = formatFeedbackMessage({
    channel: "discord",
    message: opts.message,
    contactInfo: opts.contactInfo,
    fileName: opts.fileName,
  });

  if (opts.fileContent && opts.fileName) {
    const formData = new FormData();
    formData.append("payload_json", JSON.stringify({ content }));
    const fileBlob = new Blob([Buffer.from(opts.fileContent, "base64")]);
    formData.append("files[0]", fileBlob, opts.fileName);
    const res = await fetch(webhookUrl, { method: "POST", body: formData });
    if (!res.ok) throw new Error(`Discord API error: ${res.status}`);
  } else {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error(`Discord API error: ${res.status}`);
  }
}

export async function sendTelegramMessage(opts: TelegramMessageOpts): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not configured");
  if (!chatId) throw new Error("TELEGRAM_CHAT_ID not configured");

  const text = formatFeedbackMessage({
    channel: "telegram",
    message: opts.message,
    contactInfo: opts.contactInfo,
  });

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram API error: ${res.status} — ${err}`);
  }
}
