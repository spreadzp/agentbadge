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
} from "@agentgate-hedera/mcp";

registerPassportTools();
registerAuditCatalogTools();
registerDirectoryTools();
registerA2ATools();
registerMarketplaceTools();
registerGuideTools();
registerSigningTools();
registerDiscoveryTools();

startStdio().catch((e) => {
  console.error("Failed to start MCP stdio server", e);
  process.exit(1);
});
