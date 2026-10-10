/** EPIC-184: self-serve agent registration env section. */
export interface AgentRegistrationEnvConfig {
  enabled: true;
  /** Registration store backend (json default; db backend — O3 later). */
  store: "json" | "memory";
  /** Max registrations per IP per rolling day (sybil guard). */
  dailyLimit: number;
  /** Observer-tier keyed free limit advertised in responses (req/min). */
  keyRpm: number;
  /** Gas ceiling applied to the ERC-8004 register() call. */
  gasCap: number;
  /**
   * Platform ops signer (ARC_OPS_KEY) paying mint gas.
   * Absent when enabled → misconfig; routes must answer 503.
   */
  opsKey?: `0x${string}`;
  /**
   * SLICE-184-5: sponsored (gasless) registration — REGISTER_SPONSORED.
   * When true, POST with {owner, signature} mints to the user's EOA
   * via treasury-paid mint+transfer relayer (D-184-10).
   */
  sponsored: boolean;
  /** Daily treasury-budget cap for sponsored mints (sponcap:<day>). */
  sponsoredDaily: number;
}
