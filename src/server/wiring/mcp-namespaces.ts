// EPIC-140 (SLICE-140-6): MCP namespace setup extracted from index.ts.
// Invariant: register*Tools MUST run BEFORE createNamespaceRoutes mounts —
// createNamespaceRoutes calls getNamespace at mount time.
// registerMcpNamespaces() returns handles so circle-payments (140-5) can
// register its tools into the "market" namespace without re-creating it.

import type { Hono } from "hono";
import {
  createNamespace,
  registerPassportTools,
  registerAuditCatalogTools,
  registerDirectoryTools,
  registerA2ATools,
  registerMarketplaceTools,
  registerGuideTools,
  registerSigningTools,
  registerDiscoveryTools,
  registerEscrowTools,
  registerDatasetTools,
  registerAllTools,
  type NamespaceRegistry,
} from "@agentbadge/mcp";
import { registerComplianceTools } from "../../mcp/compliance-tools";
import { registerParityTools } from "../../mcp/parity-tools";
import { registerKeeperhubTools } from "../../mcp/keeperhub-tools";
import { createNamespaceRoutes } from "../routes/mcp-namespace";

export interface McpNamespaces {
  passportNs: NamespaceRegistry;
  marketNs: NamespaceRegistry;
  discoveryNs: NamespaceRegistry;
  auditNs: NamespaceRegistry;
}

// Register MCP namespace tools BEFORE mounting namespace routes
// (createNamespaceRoutes calls getNamespace at mount time)
export function registerMcpNamespaces(): McpNamespaces {
  const passportNs = createNamespace("passport");
  registerPassportTools(passportNs);
  registerSigningTools(passportNs);
  registerEscrowTools(passportNs);

  const marketNs = createNamespace("market");
  registerMarketplaceTools(marketNs);
  registerDatasetTools(marketNs);

  const discoveryNs = createNamespace("discovery");
  registerDiscoveryTools(discoveryNs);
  registerDirectoryTools(discoveryNs);
  registerGuideTools(discoveryNs);
  registerA2ATools(discoveryNs);

  const auditNs = createNamespace("audit");
  registerAuditCatalogTools(auditNs);
  registerComplianceTools(auditNs);
  registerParityTools(auditNs);

  return { passportNs, marketNs, discoveryNs, auditNs };
}

// Namespace MCP routes — each serves only its namespace's tools
export function wireMcpNamespaceRoutes(app: Hono): void {
  app.route("/mcp/passport", createNamespaceRoutes("passport"));
  app.route("/mcp/market", createNamespaceRoutes("market"));
  app.route("/mcp/discovery", createNamespaceRoutes("discovery"));
  app.route("/mcp/audit", createNamespaceRoutes("audit"));
}

// Register MCP tools — default "all" namespace (backward compat)
export function registerDefaultMcpTools(): void {
  registerAllTools();
  registerComplianceTools();
  registerParityTools();
  registerKeeperhubTools();
}
