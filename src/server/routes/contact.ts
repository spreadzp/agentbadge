import { Hono } from "hono";
import { contactPage, contactSuccessFragment, contactErrorFragment } from "../../views/contact-page";
import {
  sendDiscordMessage,
  sendTelegramMessage,
  sendEmailMessage,
} from "../services/contact.service";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import { createRateLimiter } from "../middleware/rate-limit";

export const contactRoutes = new Hono();

const contactLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 1,
  routes: ["/contact"],
});

export function resetRateLimit(): void {
  // No-op — unified limiter handles its own store
}

function isHtmxRequest(c: import("hono").Context): boolean {
  return c.req.header("HX-Request") === "true";
}

contactRoutes.get("/contact", (c) => {
  return c.html(contactPage().toString());
});

contactRoutes.post("/contact", async (c) => {
  const htmx = isHtmxRequest(c);
  const contentType = c.req.header("content-type") ?? "";

  let channel: string | undefined;
  let message: string | undefined;
  let contactInfo: string | undefined;
  let fileName: string | undefined;
  let fileContent: string | undefined;

  if (contentType.includes("multipart/form-data")) {
    try {
      const form = await c.req.parseBody();
      channel = form.channel as string | undefined;
      message = form.message as string | undefined;
      contactInfo = (form.contactInfo as string | undefined) || undefined;
      const file = form.file;
      if (file instanceof File && file.size > 0) {
        fileName = file.name;
        const buf = await file.arrayBuffer();
        fileContent = Buffer.from(buf).toString("base64");
      }
    } catch {
      const msg = "Invalid form data";
      return htmx
        ? c.html(contactErrorFragment(msg), 400)
        : errorResponse(c, 400, ErrorCodes.INVALID_JSON, msg);
    }
  } else {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      const msg = "Invalid JSON";
      return htmx
        ? c.html(contactErrorFragment(msg), 400)
        : errorResponse(c, 400, ErrorCodes.INVALID_JSON, msg);
    }
    const parsed = body as {
      channel?: string;
      message?: string;
      contactInfo?: string;
      fileName?: string;
      fileContent?: string;
    };
    channel = parsed.channel;
    message = parsed.message;
    contactInfo = parsed.contactInfo;
    fileName = parsed.fileName;
    fileContent = parsed.fileContent;
  }

  if (!channel || !["discord", "telegram", "email"].includes(channel)) {
    const msg = "Channel must be 'discord', 'telegram', or 'email'";
    return htmx
      ? c.html(contactErrorFragment(msg), 400)
      : errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, msg);
  }
  if (!message || message.trim().length === 0) {
    const msg = "Message is required";
    return htmx
      ? c.html(contactErrorFragment(msg), 400)
      : errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, msg);
  }
  if (message.length > 4096) {
    const msg = "Message too long (max 4096 chars)";
    return htmx
      ? c.html(contactErrorFragment(msg), 400)
      : errorResponse(c, 400, ErrorCodes.INVALID_JSON, msg);
  }
  if (contactInfo && contactInfo.length > 200) {
    const msg = "Contact info too long (max 200 chars)";
    return htmx
      ? c.html(contactErrorFragment(msg), 400)
      : errorResponse(c, 400, ErrorCodes.INVALID_JSON, msg);
  }
  if (fileContent && Buffer.from(fileContent, "base64").length > 1_048_576) {
    const msg = "File too large (max 1MB)";
    return htmx
      ? c.html(contactErrorFragment(msg), 400)
      : errorResponse(c, 400, ErrorCodes.INVALID_JSON, msg);
  }

  const rateLimitResult = await contactLimiter(c, async () => { });
  if (rateLimitResult instanceof Response) {
    const msg = "Rate limit exceeded. Try again in a minute.";
    return htmx
      ? c.html(contactErrorFragment(msg), 429)
      : errorResponse(c, 429, ErrorCodes.RATE_LIMITED, msg);
  }

  try {
    if (channel === "discord") {
      await sendDiscordMessage({ message, contactInfo, fileName, fileContent });
    } else if (channel === "telegram") {
      await sendTelegramMessage({ message, contactInfo });
    } else {
      await sendEmailMessage({ message, contactInfo });
    }
    return htmx
      ? c.html(contactSuccessFragment(channel), 200)
      : c.json({ success: true, channel }, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to send message";
    return htmx
      ? c.html(contactErrorFragment(msg), 500)
      : errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR, msg, { retryable: true });
  }
});
