/**
 * SLICE-184-3/184-5 (EPIC-184): public JSON view of a registration
 * record — keyHash never leaves the server; sponsored mints surface
 * owner + owner_tx so callers can verify on-chain ownership.
 */
import type { AgentRegistration } from "./store";

export const publicRecord = (rec: AgentRegistration) => ({
  agent_id: rec.agentId,
  registry: "erc-8004",
  registry_address: rec.registryAddress,
  registry_tx: rec.registryTx,
  name: rec.name,
  ...(rec.endpoint ? { endpoint: rec.endpoint } : {}),
  tier: rec.tier,
  status: rec.status,
  ...(rec.sponsored
    ? { sponsored: true, owner: rec.owner, owner_tx: rec.ownerTx }
    : {}),
  reputation: null as null,
  reputation_note: "no_data",
  created_at: rec.createdAt,
});
