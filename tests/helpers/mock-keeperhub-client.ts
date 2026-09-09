import { vi } from "vitest";

export interface MockExecutionResult {
  executionId: string;
  status: string;
  txHashes: string[];
  error?: string;
}

export function makeMockKeeperHubClient(overrides: Partial<{
  workflows: string[];
  executionResult: MockExecutionResult;
  pollError: Error | null;
}> = {}) {
  const workflows = overrides.workflows ?? [
    "agentbadge-record-scan",
    "agentbadge-mint-passport",
    "agentbadge-notify",
  ];

  const defaultResult: MockExecutionResult = overrides.executionResult ?? {
    executionId: "exec-mock-001",
    status: "success",
    txHashes: ["0xabc123"],
  };

  return {
    connect: vi.fn().mockResolvedValue(undefined),
    listWorkflows: vi.fn().mockResolvedValue(workflows),
    executeWorkflow: vi.fn().mockResolvedValue({ executionId: defaultResult.executionId }),
    getExecution: vi.fn().mockResolvedValue(defaultResult),
    pollExecution: vi.fn().mockImplementation(async (executionId: string) => {
      if (overrides.pollError) throw overrides.pollError;
      return { ...defaultResult, executionId };
    }),
    txHashes: vi.fn((exec: { txHashes?: string[] }) => exec.txHashes ?? []),
    _workflows: workflows,
    _result: defaultResult,
  };
}

export function makeMockKeeperHubConfig(overrides: Partial<{
  enabled: boolean;
  apiKey: string;
  serverUrl: string;
  workflowIds: Partial<{ recordScan: string; mintPassport: string; notify: string }>;
  x402Enabled: boolean;
  triggerMode: string;
  auditSecret: string;
  webhookUrls: Record<string, string>;
  apiBaseUrl: string;
}> = {}) {
  return {
    enabled: overrides.enabled ?? true,
    apiKey: overrides.apiKey ?? "kh_test_key",
    serverUrl: overrides.serverUrl ?? "https://app.keeperhub.com/mcp",
    webhookKey: "wfb_test_key",
    auditSecret: overrides.auditSecret ?? undefined,
    apiBaseUrl: overrides.apiBaseUrl ?? "https://agentbadge.xyz",
    triggerMode: (overrides.triggerMode ?? "mcp") as "mcp" | "webhook",
    webhookUrls: overrides.webhookUrls ?? {},
    x402: overrides.x402Enabled ? {
      enabled: true,
      facilitatorUrl: "https://x402.org/facilitator",
      payTo: "0xtest",
      price: "$0.01",
    } : undefined,
    registryAddress: "0xregistry_test",
    badgeAddress: "0xbadge_test",
    workflowIds: {
      recordScan: overrides.workflowIds?.recordScan ?? "wf_record_scan_001",
      mintPassport: overrides.workflowIds?.mintPassport ?? "wf_mint_passport_001",
      notify: overrides.workflowIds?.notify ?? "wf_notify_001",
    },
  };
}
