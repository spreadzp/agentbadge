/**
 * KeeperHub config section (EPIC-140, SLICE-140-25).
 * Optional — only loaded when KEEPERHUB_ENABLED=true.
 */

import type { KeeperHubEnvConfig, X402Config } from "./types";
import { booleanFlag, requiredString } from "./validators";

export function loadKeeperHub(
  errors: string[],
): KeeperHubEnvConfig | undefined {
  if (!booleanFlag("KEEPERHUB_ENABLED")) return undefined;

  const khApiKey = requiredString("KEEPERHUB_API_KEY", errors);
  if (khApiKey && !khApiKey.startsWith("kh_")) {
    errors.push(
      "Invalid KEEPERHUB_API_KEY: expected kh_ prefix (wfb_ keys are for webhook triggers only)",
    );
  }
  const khWebhookKey = process.env.KEEPERHUB_WEBHOOK_KEY;
  if (khWebhookKey && !khWebhookKey.startsWith("wfb_")) {
    errors.push("Invalid KEEPERHUB_WEBHOOK_KEY: expected wfb_ prefix");
  }
  // Parse webhook URLs JSON map (workflowName → url)
  let khWebhookUrls: Record<string, string> = {};
  const khWebhookUrlsRaw = process.env.KEEPERHUB_WEBHOOK_URLS;
  if (khWebhookUrlsRaw) {
    try {
      khWebhookUrls = JSON.parse(khWebhookUrlsRaw);
    } catch {
      errors.push("Invalid KEEPERHUB_WEBHOOK_URLS: expected JSON object");
    }
  }
  const khTriggerMode = (process.env.KEEPERHUB_TRIGGER_MODE ?? "mcp") as
    | "mcp"
    | "webhook";

  // x402 premium config — optional, default disabled
  const x402Enabled = booleanFlag("KEEPERHUB_X402_ENABLED");
  let x402: X402Config | undefined;
  if (x402Enabled) {
    x402 = {
      enabled: true,
      facilitatorUrl:
        process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
      payTo: process.env.X402_PAY_TO ?? "",
      price: process.env.X402_PRICE ?? "$0.01",
    };
    if (!x402.payTo) {
      errors.push("X402_PAY_TO required when KEEPERHUB_X402_ENABLED=true");
    }
  }

  return {
    enabled: true,
    apiKey: khApiKey ?? "",
    serverUrl:
      process.env.KEEPERHUB_SERVER_URL ?? "https://app.keeperhub.com/mcp",
    webhookKey: khWebhookKey,
    auditSecret: process.env.KEEPERHUB_AUDIT_SECRET,
    apiBaseUrl:
      process.env.KEEPERHUB_API_BASE_URL ??
      process.env.BASE_URL ??
      "https://agentbadge.xyz",
    triggerMode: khTriggerMode,
    webhookUrls: khWebhookUrls,
    x402,
    registryAddress: process.env.KEEPERHUB_REGISTRY_ADDRESS,
    badgeAddress: process.env.KEEPERHUB_BADGE_ADDRESS,
    workflowIds: {
      recordScan: process.env.KEEPERHUB_WORKFLOW_RECORD_SCAN,
      mintPassport: process.env.KEEPERHUB_WORKFLOW_MINT_PASSPORT,
      notify: process.env.KEEPERHUB_WORKFLOW_NOTIFY,
    },
  };
}
