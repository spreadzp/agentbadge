import { z } from "zod";
import { ok, fail } from "./types.js";
export const workflowStatusTool = {
    name: "keeperhub-workflow-status",
    description: "Reads the current status of a KeeperHub workflow execution by ID. Returns execution state, transaction hashes, and any error. Read-only — no side effects.",
    inputSchema: {
        executionId: z.string().min(1),
    },
    annotations: {
        readOnlyHint: true,
        untrustedContentHint: false,
        title: "KeeperHub Workflow Status",
    },
    createHandler: (ctx) => async (args) => {
        const executionId = args.executionId;
        try {
            const exec = await ctx.client.getExecution(executionId);
            return ok({
                executionId: exec.executionId,
                status: exec.status,
                transactionHashes: exec.transactionHashes,
                error: exec.error,
            });
        }
        catch (e) {
            return fail(`workflow-status failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    },
};
