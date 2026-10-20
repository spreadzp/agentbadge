/** MCP abuse-guard (EPIC-200, SLICE-200-08, D-200-2).
 *  Default ON; MCP_ABUSE_ENABLED=false disables. Split out of
 *  types.ts (300-line cap) — same pattern as agent-wallet-types.ts. */
export interface McpAbuseEnvConfig {
  enabled: boolean;
  /** anonymous per-IP cap per minute (default 60) */
  anonRpm: number;
  /** keyed agb_ agent cap per minute (default 120) */
  keyedRpm: number;
  /** heavy-op cap per lane per minute (default 10) */
  heavyRpm: number;
  /** MCP_ABUSE_HEAVY_OPS override; undefined = built-in default list */
  heavyOps?: string[];
  /** x402 heavy-op gate — both price and payTo required to arm */
  heavyX402Price?: string;
  heavyX402PayTo?: string;
}

// types.ts is at the 300-line cap — augment AppConfig here instead of
// adding a field there. Merges into AppConfig wherever ./types resolves.
declare module "./types" {
  interface AppConfig {
    mcpAbuse?: McpAbuseEnvConfig;
  }
}
