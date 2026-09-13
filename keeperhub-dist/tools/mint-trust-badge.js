import { z } from "zod";
import { ok, fail } from "./types.js";
export const mintTrustBadgeTool = {
    name: "keeperhub-mint-trust-badge",
    description: "Mints a TrustBadge (soulbound NFT) for a site via KeeperHub workflow. By default (confirm not set), previews the mint transaction. Set confirm=true to execute: mints AgentPassport NFT then TrustBadge sequentially, then polls for confirmation.",
    inputSchema: {
        to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        siteUrl: z.string().url(),
        score: z.number().int().min(0).max(100),
        badgeUri: z.string().min(1),
        confirm: z.boolean().optional(),
    },
    annotations: {
        readOnlyHint: false,
        untrustedContentHint: false,
        title: "KeeperHub Mint Trust Badge",
    },
    createHandler: (ctx) => async (args) => {
        const to = args.to;
        const siteUrl = args.siteUrl;
        const score = args.score;
        const badgeUri = args.badgeUri;
        const confirm = args.confirm === true;
        if (!confirm) {
            return ok({
                mode: "dry-run",
                wouldMint: {
                    workflow: "agentbadge-mint-passport",
                    passportNft: [to, "{{ passportUri }}", "{{ tier }}"],
                    trustBadge: [to, siteUrl, score, badgeUri],
                    network: "84532",
                },
                nextStep: "call again with confirm: true",
            });
        }
        if (!ctx.workflowIds.mintPassport) {
            return fail("mint-passport workflow not provisioned");
        }
        try {
            const { executionId } = await ctx.client.executeWorkflow(ctx.workflowIds.mintPassport, {
                to,
                siteUrl,
                score,
                badgeUri,
            });
            const exec = await ctx.client.pollExecution(executionId);
            return ok({
                mode: "executed",
                executionId,
                status: exec.status,
                txHashes: ctx.client.txHashes(exec),
            });
        }
        catch (e) {
            return fail(`mint-trust-badge execution failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    },
};
