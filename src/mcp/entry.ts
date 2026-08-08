import {
  startStdio,
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
} from "@agentgate-hedera/mcp";
import { registerComplianceTools } from "./compliance-tools";
import { registerParityTools } from "./parity-tools";

registerPassportTools();
registerAuditCatalogTools();
registerDirectoryTools();
registerA2ATools();
registerMarketplaceTools();
registerGuideTools();
registerSigningTools();
registerDiscoveryTools();
registerEscrowTools();
registerDatasetTools();
registerComplianceTools();
registerParityTools();

startStdio().catch((e) => {
  console.error("Failed to start MCP stdio server", e);
  process.exit(1);
});
