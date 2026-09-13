import { z } from "zod";
import { ok, fail } from "./types.js";
export const recordScanTool = {
    name: "keeperhub-record-scan",
    description: "Records an AgentBadge agent-readiness scan result onchain via KeeperHub workflow. By default (confirm not set), runs in dry-run mode: fetches the scan result and previews the onchain transaction without executing. Set confirm=true to execute the workflow and record onchain.",
    inputSchema: {
        url: z.string().url(),
        confirm: z.boolean().optional(),
    },
    annotations: {
        readOnlyHint: false,
        untrustedContentHint: true,
        title: "KeeperHub Record Scan",
    },
    createHandler: (ctx) => async (args) => {
        const url = args.url;
        const confirm = args.confirm === true;
        let scanResponse;
        try {
            scanResponse = await fetch(`${ctx.apiBaseUrl}/api/scan?url=${encodeURIComponent(url)}`);
        }
        catch (e) {
            return fail(`Scan fetch failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (!scanResponse.ok) {
            return fail(`Scan fetch failed: HTTP ${scanResponse.status}`);
        }
        const scan = await scanResponse.json();
        const siteUrl = scan.url ?? url;
        const score = scan.score ?? 0;
        const rulesPassed = scan.rulesPassed ?? 0;
        const rulesTotal = scan.rulesTotal ?? 0;
        if (!confirm) {
            return ok({
                mode: "dry-run",
                scan,
                wouldRecord: {
                    workflow: "agentbadge-record-scan",
                    functionArgs: [siteUrl, score, rulesPassed, rulesTotal],
                    network: "84532",
                },
                nextStep: "call again with confirm: true",
            });
        }
        if (!ctx.workflowIds.recordScan) {
            return fail("record-scan workflow not provisioned");
        }
        try {
            const { executionId } = await ctx.client.executeWorkflow(ctx.workflowIds.recordScan, {
                siteUrl,
                score,
                rulesPassed,
                rulesTotal,
            });
            const exec = await ctx.client.pollExecution(executionId);
            return ok({
                mode: "executed",
                executionId,
                status: exec.status,
                txHashes: ctx.client.txHashes(exec),
                scan,
            });
        }
        catch (e) {
            return fail(`record-scan execution failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    },
};
