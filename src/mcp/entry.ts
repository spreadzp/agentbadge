import {
  createNamespace,
  getNamespace,
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
} from "@agentbadge/mcp";
import { registerComplianceTools } from "./compliance-tools";
import { registerParityTools } from "./parity-tools";
import { registerAttestcoinTools, setAttestcoinToolConfig } from "./attestcoin-tools";

function registerServerAllTools(ns?: NamespaceRegistry): void {
  registerPassportTools(ns);
  registerSigningTools(ns);
  registerEscrowTools(ns);
  registerMarketplaceTools(ns);
  registerDatasetTools(ns);
  registerDiscoveryTools(ns);
  registerDirectoryTools(ns);
  registerGuideTools(ns);
  registerA2ATools(ns);
  registerAuditCatalogTools(ns);
  registerComplianceTools(ns);
  registerParityTools(ns);

  // Attestcoin tools (EPIC-127) — only when ATTESTCOIN_ENABLED=true
  if (process.env.ATTESTCOIN_ENABLED === "true") {
    setAttestcoinToolConfig({
      enabled: true,
      creditcoinRpcUrl: process.env.CREDITCOIN_RPC_URL ?? "https://rpc.cc3-testnet.creditcoin.network",
      taskStateAddr: process.env.TASK_STATE_ADDR ?? "",
    });
    registerAttestcoinTools(ns);
  }
}

const namespace = process.env.MCP_NAMESPACE ?? process.argv[2] ?? "all";

let ns: NamespaceRegistry;

if (namespace === "all") {
  registerServerAllTools();
  ns = getNamespace("all")!;
} else {
  ns = createNamespace(namespace);
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
}

ns.startStdio().catch((e) => {
  console.error("Failed to start MCP stdio server", e);
  process.exit(1);
});
