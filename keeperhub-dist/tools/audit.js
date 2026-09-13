import { z } from "zod";
import { ok, fail } from "./types.js";
export const auditTool = {
    name: "keeperhub-audit",
    description: "Fetches onchain audit records for a site from the AgentBadge audit API. Returns trust records (scan results, badge mints) stored onchain. Read-only — queries the server audit endpoint.",
    inputSchema: {
        siteUrl: z.string().url().optional(),
    },
    annotations: {
        readOnlyHint: true,
        untrustedContentHint: true,
        title: "KeeperHub Audit",
    },
    createHandler: (ctx) => async (args) => {
        const siteUrl = args.siteUrl;
        const query = siteUrl ? `?siteUrl=${encodeURIComponent(siteUrl)}` : "";
        let response;
        try {
            response = await fetch(`${ctx.apiBaseUrl}/api/keeperhub/audit${query}`);
        }
        catch (e) {
            return fail(`Audit fetch failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (!response.ok) {
            return fail(`Audit fetch failed: HTTP ${response.status}`);
        }
        const data = await response.json();
        return ok(data);
    },
};
