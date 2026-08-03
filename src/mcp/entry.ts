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
} from "@agentgate-hedera/mcp";
import { registerDatasetTools } from "./dataset.tools";

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

startStdio().catch((e) => {
  console.error("Failed to start MCP stdio server", e);
  process.exit(1);
});
