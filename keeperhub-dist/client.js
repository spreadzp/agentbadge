import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const DEFAULT_SERVER_URL = "https://app.keeperhub.com/mcp";
const TERMINAL = ["success", "error", "system_error", "cancelled"];
export class KeeperHubClient {
    client = null;
    config;
    constructor(config) {
        if (!config.apiKey?.startsWith("kh_")) {
            throw new Error("KeeperHubClient: apiKey must be an organization key with kh_ prefix (wfb_ webhook keys are not valid for MCP)");
        }
        this.config = { ...config, serverUrl: config.serverUrl ?? DEFAULT_SERVER_URL };
    }
    async connect() {
        if (this.client)
            return;
        this.client = new Client({ name: this.config.clientName ?? "agentbadge-keeperhub", version: "0.1.0" });
        const transport = new StreamableHTTPClientTransport(new URL(this.config.serverUrl), {
            requestInit: { headers: { Authorization: `Bearer ${this.config.apiKey}` } },
        });
        await this.client.connect(transport);
    }
    async close() {
        await this.client?.close();
        this.client = null;
    }
    async call(tool, args = {}, opts = {}) {
        this.assertConnected();
        const idempKey = opts.idempotencyKey ?? this.config.idempotencyKey;
        const merged = idempKey ? { ...args, idempotency_key: idempKey } : args;
        try {
            return (await this.client.callTool({ name: tool, arguments: merged }, undefined, {
                timeout: opts.timeoutMs ?? this.config.timeoutMs ?? 30000,
            }));
        }
        catch (e) {
            const err = this.normalizeTransportError(e);
            if (err.code === 429 && (opts._attempt ?? 0) < 5) {
                const wait = err.retryAfterSeconds ?? 2 ** (opts._attempt ?? 0);
                await sleep(wait * 1000);
                return this.call(tool, args, { ...opts, _attempt: (opts._attempt ?? 0) + 1 });
            }
            throw err;
        }
    }
    unwrap(result) {
        if (result.isError) {
            throw this.toKeeperHubError(result);
        }
        const first = result.content?.[0];
        if (first && "text" in first) {
            try {
                return JSON.parse(first.text);
            }
            catch {
                return first.text;
            }
        }
        return result;
    }
    toKeeperHubError(result) {
        const text = result.content?.find((c) => c.type === "text")?.text ?? "Unknown KeeperHub error";
        const codeMatch = text.match(/\b(40\d|429|500)\b/);
        const retryMatch = text.match(/Retry-After:?\s*(\d+)/i);
        return { code: codeMatch ? Number(codeMatch[1]) : 500, message: text, retryAfterSeconds: retryMatch ? Number(retryMatch[1]) : undefined, raw: result };
    }
    normalizeTransportError(e) {
        const msg = e instanceof Error ? e.message : String(e);
        const codeMatch = msg.match(/\b(40\d|429|500)\b/);
        const retryMatch = msg.match(/Retry-After:?\s*(\d+)/i);
        return { code: codeMatch ? Number(codeMatch[1]) : 500, message: msg, retryAfterSeconds: retryMatch ? Number(retryMatch[1]) : undefined, raw: e };
    }
    async ping() { await this.call("list_workflows", {}); return true; }
    async listWorkflows() {
        return this.unwrap(await this.call("list_workflows"));
    }
    async createWorkflow(spec, opts) {
        return this.unwrap(await this.call("create_workflow", spec, { ...opts, idempotencyKey: opts?.idempotencyKey }));
    }
    async executeWorkflow(workflowId, inputs, opts) {
        return this.unwrap(await this.call("execute_workflow", { workflowId, input: inputs ?? {} }, opts));
    }
    async getExecution(executionId) {
        return this.unwrap(await this.call("get_execution", { executionId }));
    }
    async pollExecution(executionId, poll = {}) {
        const intervalMs = poll.intervalMs ?? 2000;
        const deadline = Date.now() + (poll.timeoutMs ?? 120000);
        for (;;) {
            const exec = await this.getExecution(executionId);
            const state = exec.status?.status ?? exec.status;
            if (TERMINAL.includes(state)) {
                if (state === "success")
                    return exec;
                const errMsg = exec.status?.errorContext?.error ?? exec.error ?? `status: ${state}`;
                throw new Error(`pollExecution: execution ${executionId} ended with status "${state}": ${errMsg}`);
            }
            if (Date.now() >= deadline) {
                throw new Error(`pollExecution: execution ${executionId} timed out after ${poll.timeoutMs ?? 120000}ms`);
            }
            await sleep(intervalMs);
        }
    }
    txHashes(exec) {
        return (exec.status?.transactionHashes ?? []).map((r) => r.hash);
    }
    async listActionSchemas(category) {
        return this.unwrap(await this.call("list_action_schemas", category ? { category } : {}));
    }
    async getWalletIntegration() {
        return this.unwrap(await this.call("get_wallet_integration"));
    }
    async listWorkflow(workflowId, metadata) {
        return this.unwrap(await this.call("list_workflow", { workflowId, ...metadata }));
    }
    async getWorkflowListing(slug) {
        return this.unwrap(await this.call("get_workflow_listing", { slug }));
    }
    assertConnected() {
        if (!this.client)
            throw new Error("KeeperHubClient: not connected — call connect() first");
    }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
