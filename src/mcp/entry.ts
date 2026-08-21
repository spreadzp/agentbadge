import {
  startStdio,
  createNamespace,
  registerAllTools,
  registerPassportTools,
  registerSigningTools,
  registerEscrowTools,
  registerMarketplaceTools,
  registerDatasetTools,
  registerDiscoveryTools,
  registerDirectoryTools,
  registerGuideTools,
  registerA2ATools,
  registerAuditCatalogTools,
  type NamespaceRegistry,
} from "@agentgate-hedera/mcp";
import { registerComplianceTools } from "./compliance-tools";
import { registerParityTools } from "./parity-tools";

const namespace = process.env.MCP_NAMESPACE ?? process.argv[2] ?? "all";

function registerNamespaceTools(ns: NamespaceRegistry): void {
  registerAllTools(ns);
  registerComplianceTools(ns);
  registerParityTools(ns);
}

if (namespace === "all") {
  registerAllTools();
  registerComplianceTools();
  registerParityTools();
  const allNs = createNamespace("all");
  registerNamespaceTools(allNs);
  allNs.startStdio().catch((e) => {
    console.error("Failed to start MCP stdio server", e);
    process.exit(1);
  });
} else {
  const ns = createNamespace(namespace);
  switch (namespace) {
    case "passport":
      registerPassportTools(ns);
      registerSigningTools(ns);
      registerEscrowTools(ns);
      break;
    case "market":
      registerMarketplaceTools(ns);
      registerDatasetTools(ns);
      break;
    case "discovery":
      registerDiscoveryTools(ns);
      registerDirectoryTools(ns);
      registerGuideTools(ns);
      registerA2ATools(ns);
      break;
    case "audit":
      registerAuditCatalogTools(ns);
      registerComplianceTools(ns);
      registerParityTools(ns);
      break;
    default:
      console.error(`Unknown namespace: ${namespace}`);
      process.exit(1);
  }
  ns.startStdio().catch((e) => {
    console.error("Failed to start MCP stdio server", e);
    process.exit(1);
  });
}
