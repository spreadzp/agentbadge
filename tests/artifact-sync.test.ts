import { describe, it, expect } from "vitest";
import { softwareApplicationLd, organizationLd } from "../src/server/lib/json-ld";
import { listTools } from "@agentgate-hedera/mcp";
import {
  registerPassportTools,
  registerAuditCatalogTools,
  registerDirectoryTools,
  registerA2ATools,
  registerMarketplaceTools,
  registerGuideTools,
  registerSigningTools,
  registerDiscoveryTools,
} from "@agentgate-hedera/mcp";

// Register all tools so listTools() returns the full set
registerPassportTools();
registerAuditCatalogTools();
registerDirectoryTools();
registerA2ATools();
registerMarketplaceTools();
registerGuideTools();
registerSigningTools();
registerDiscoveryTools();

const ACTUAL_TOOL_COUNT = listTools().length;

describe("SLICE-80-4: Artifact sync — no hardcoded tool counts", () => {
  it("softwareApplicationLd featureList uses dynamic tool count, not literal 38", () => {
    const ld = softwareApplicationLd() as { featureList: string[] };
    const mcpEntry = ld.featureList.find((f) => f.includes("MCP server"));
    expect(mcpEntry).toBeDefined();
    expect(mcpEntry).toContain(`${ACTUAL_TOOL_COUNT} tools`);
    expect(mcpEntry).not.toContain("38 tools");
  });

  it("no literal '38 tools' remains in featureList", () => {
    const ld = softwareApplicationLd() as { featureList: string[] };
    for (const f of ld.featureList) {
      expect(f).not.toContain("38 tools");
      expect(f).not.toContain("38 MCP");
    }
  });

  it("organizationLd logo points at >=112px asset, not logo-32.png", () => {
    const ld = organizationLd() as { logo: string };
    expect(ld.logo).not.toContain("logo-32");
    expect(ld.logo).toContain("logo-512");
  });
});
