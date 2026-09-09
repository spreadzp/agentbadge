import { KeeperHubClient } from "@agentbadge/keeperhub";
import { getConfig } from "../../config/env";

let clientInstance: KeeperHubClient | null = null;

/** Lazy singleton — connects on first use. Returns null when disabled. */
export function getKeeperHubClient(): KeeperHubClient | null {
  const cfg = getConfig();
  if (!cfg.keeperhub?.enabled) return null;
  if (!clientInstance) {
    clientInstance = new KeeperHubClient({
      apiKey: cfg.keeperhub.apiKey,
      serverUrl: cfg.keeperhub.serverUrl,
    });
  }
  return clientInstance;
}

/** Handler context for tool factories (SLICE-126-8 pattern). */
export function getKeeperHubToolContext() {
  const cfg = getConfig();
  const client = getKeeperHubClient();
  if (!client || !cfg.keeperhub) return null;
  return {
    client,
    apiBaseUrl: cfg.keeperhub.apiBaseUrl,
    workflowIds: cfg.keeperhub.workflowIds,
  };
}

/** 503 body for disabled state — consistent across all keeperhub routes. */
export function keeperhubDisabledResponse() {
  return { error: "KeeperHub integration not enabled (set KEEPERHUB_ENABLED=true)" };
}

/** Reset singleton — for test teardown. */
export function resetKeeperHubClient(): void {
  clientInstance = null;
}
