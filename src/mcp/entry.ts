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
import { registerCirclePayTools, setCirclePayToolConfig } from "./circle-pay-tools";
import { registerPaymentStatusTools, setPaymentStatusToolConfig } from "./payment-status-tools";
import { registerAgentIdentityTools, setAgentIdentityToolConfig } from "./agent-identity-tools";
import { registerCircleWalletBalanceTools, setCircleWalletBalanceToolConfig } from "./circle-wallet-balance-tools";
import { registerSupportedNetworksTools, setSupportedNetworksToolConfig } from "./supported-networks-tools";
import { loadConfig, getConfig } from "../config/env";
import { createCirclePaymentsRuntime } from "../server/lib/circle-payments";

// SLICE-129-15/16: build circle runtime for circle MCP tools (stdio).
// Flag off or config invalid → tools stay unregistered.
function initCircleTools(ns?: NamespaceRegistry): void {
  if (process.env.CIRCLE_PAYMENTS_ENABLED !== "true") return;
  try {
    loadConfig();
    const cfg = getConfig().circlePayments;
    if (!cfg?.enabled) return;
    const rt = createCirclePaymentsRuntime(cfg);
    setCirclePayToolConfig({ router: rt.router });
    registerCirclePayTools(ns);
    setPaymentStatusToolConfig({ statusLookup: rt.statusLookup });
    registerPaymentStatusTools(ns);
    setAgentIdentityToolConfig({ lookup: rt.lookup });
    registerAgentIdentityTools(ns);
    setCircleWalletBalanceToolConfig({ balanceLookup: rt.balanceLookup });
    registerCircleWalletBalanceTools(ns);
    setSupportedNetworksToolConfig({
      router: rt.router,
      getFlags: () => {
        const c = getConfig().circlePayments;
        return {
          gateway: c?.gateway ?? false,
          arc: c?.arc ?? false,
          identity: c?.identity ?? false,
          escrow: c?.escrow ?? false,
        };
      },
    });
    registerSupportedNetworksTools(ns);
  } catch (e) {
    console.error("circle MCP tools not registered:", e instanceof Error ? e.message : e);
  }
}

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

  // Circle payments (EPIC-129) — only when CIRCLE_PAYMENTS_ENABLED=true
  initCircleTools(ns);
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
      initCircleTools(ns);
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
