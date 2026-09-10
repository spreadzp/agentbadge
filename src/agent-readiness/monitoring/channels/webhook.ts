/**
 * SLICE-99-6: Webhook channel adapter.
 *
 * HTTP POST JSON payload with HMAC-SHA256 signature header.
 * Timeout + retry once. SSRF-safe (targets are user-configured URLs,
 * validated at CRUD boundary in 99-2).
 */

import { createHmac } from "node:crypto";

export interface WebhookResult {
  ok: boolean;
  error?: string;
  statusCode?: number;
}

export async function sendWebhook(
  url: string,
  payload: Record<string, unknown>,
  secret?: string,
  timeoutMs: number = 5000,
): Promise<WebhookResult> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (secret) {
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    headers["X-AgentBadge-Signature"] = signature;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        return { ok: true, statusCode: response.status };
      }

      // Non-2xx: retry once, then fail
      if (attempt === 0) continue;
      return { ok: false, statusCode: response.status, error: `HTTP ${response.status}` };
    } catch (err) {
      if (attempt === 0) continue;
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  return { ok: false, error: "Max retries exceeded" };
}
