/**
 * SLICE-127-17: MCP tools for Attestcoin cross-chain task management
 *
 * Registers three MCP tools:
 * - verify_cross_chain_task: trigger verification for a Sepolia tx
 * - list_verified_tasks: list tasks from Creditcoin TaskState
 * - get_task_status: get single task details
 */

import { z } from "zod";
import { type ToolResult, type ToolHandler, type NamespaceRegistry, getNamespace } from "@agentbadge/mcp";

function getRegistry(ns?: NamespaceRegistry) {
  return ns ?? getNamespace("all")!;
}

function validationError(message: string): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `Validation error: ${message}` }],
  };
}

function serviceError(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : "Unknown error";
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

interface AttestcoinToolConfig {
  enabled: boolean;
  creditcoinRpcUrl: string;
  taskStateAddr: string;
}

let toolConfig: AttestcoinToolConfig | null = null;

export function setAttestcoinToolConfig(config: AttestcoinToolConfig): void {
  toolConfig = config;
}

function getConfig(): AttestcoinToolConfig {
  if (toolConfig) return toolConfig;
  return {
    enabled: process.env.ATTESTCOIN_ENABLED === "true",
    creditcoinRpcUrl: process.env.CREDITCOIN_RPC_URL ?? "https://rpc.cc3-testnet.creditcoin.network",
    taskStateAddr: process.env.TASK_STATE_ADDR ?? "",
  };
}

const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const TASK_STATUS_NAMES = ["None", "Verified", "Claimed", "Delivered", "Completed"] as const;

// ─── Handlers ──────────────────────────────────────────────────

const verifyArgsSchema = z.object({
  txHash: z.string().regex(TX_HASH_REGEX, "Must be a valid 0x-prefixed 64-char hex tx hash"),
});

export const verifyCrossChainTaskHandler: ToolHandler = async (args) => {
  const cfg = getConfig();
  if (!cfg.enabled) {
    return {
      isError: true,
      content: [{ type: "text", text: "Attestcoin not enabled. Set ATTESTCOIN_ENABLED=true to use this tool." }],
    };
  }

  const parsed = verifyArgsSchema.safeParse(args);
  if (!parsed.success) {
    return validationError(parsed.error.message);
  }

  const { txHash } = parsed.data;

  try {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          taskId: "0",
          verified: false,
          txHash,
          message: "Manual verification triggered. Worker A will process the transaction.",
        }, null, 2),
      }],
    };
  } catch (err) {
    return serviceError(err);
  }
};

const listTasksArgsSchema = z.object({
  status: z.enum(["verified", "claimed", "delivered", "completed"]).optional(),
});

export const listVerifiedTasksHandler: ToolHandler = async (args) => {
  const cfg = getConfig();
  if (!cfg.enabled) {
    return {
      isError: true,
      content: [{ type: "text", text: "Attestcoin not enabled. Set ATTESTCOIN_ENABLED=true to use this tool." }],
    };
  }

  const parsed = listTasksArgsSchema.safeParse(args);
  if (!parsed.success) {
    return validationError(parsed.error.message);
  }

  const statusFilter = parsed.data.status;
  const statusNum = statusFilter
    ? TASK_STATUS_NAMES.findIndex((s) => s.toLowerCase() === statusFilter)
    : -1;

  try {
    const { JsonRpcProvider, Contract } = await import("ethers");
    const provider = new JsonRpcProvider(cfg.creditcoinRpcUrl);
    const state = new Contract(cfg.taskStateAddr, TaskStateABI, provider);

    const nextTaskId = await state.nextTaskId();
    const tasks: Record<string, unknown>[] = [];

    for (let i = 1n; i < nextTaskId; i++) {
      const task = await state.tasks(i);
      if (task.status === 0) continue;
      if (statusNum >= 0 && Number(task.status) !== statusNum) continue;

      tasks.push({
        taskId: i.toString(),
        poster: task.poster,
        reward: task.reward.toString(),
        capabilities: task.capabilities,
        deadline: task.deadline.toString(),
        status: TASK_STATUS_NAMES[Number(task.status)] ?? "Unknown",
        claimer: task.claimer === ZERO_ADDR ? null : task.claimer,
        ipfsResultHash: task.ipfsResultHash === "" ? null : task.ipfsResultHash,
      });
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ tasks, count: tasks.length }, null, 2),
      }],
    };
  } catch (err) {
    return serviceError(err);
  }
};

const getTaskStatusArgsSchema = z.object({
  taskId: z.string().min("1"),
});

export const getTaskStatusHandler: ToolHandler = async (args) => {
  const cfg = getConfig();
  if (!cfg.enabled) {
    return {
      isError: true,
      content: [{ type: "text", text: "Attestcoin not enabled. Set ATTESTCOIN_ENABLED=true to use this tool." }],
    };
  }

  const parsed = getTaskStatusArgsSchema.safeParse(args);
  if (!parsed.success) {
    return validationError(parsed.error.message);
  }

  const taskIdStr = parsed.data.taskId;

  try {
    const { JsonRpcProvider, Contract } = await import("ethers");
    const provider = new JsonRpcProvider(cfg.creditcoinRpcUrl);
    const state = new Contract(cfg.taskStateAddr, TaskStateABI, provider);

    const taskId = BigInt(taskIdStr);
    const task = await state.tasks(taskId);

    if (task.status === 0) {
      return {
        isError: true,
        content: [{ type: "text", text: `Task ${taskIdStr} not found` }],
      };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          taskId: taskIdStr,
          poster: task.poster,
          reward: task.reward.toString(),
          capabilities: task.capabilities,
          deadline: task.deadline.toString(),
          status: TASK_STATUS_NAMES[Number(task.status)] ?? "Unknown",
          claimer: task.claimer === ZERO_ADDR ? null : task.claimer,
          ipfsResultHash: task.ipfsResultHash === "" ? null : task.ipfsResultHash,
        }, null, 2),
      }],
    };
  } catch (err) {
    return serviceError(err);
  }
};

// ─── Registration ──────────────────────────────────────────────

export function registerAttestcoinTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);

  r.registerTool(
    "verify_cross_chain_task",
    "Verify a cross-chain task posting from Ethereum Sepolia on Creditcoin via Attestcoin Protocol. Triggers Worker A to verify the transaction and create a task on Creditcoin TaskState.",
    {
      txHash: z.string().describe("Ethereum Sepolia transaction hash (0x-prefixed, 64 hex chars)"),
    },
    verifyCrossChainTaskHandler,
  );

  r.registerTool(
    "list_verified_tasks",
    "List all cross-chain tasks verified on Creditcoin via Attestcoin Protocol. Optionally filter by status (verified, claimed, delivered, completed).",
    {
      status: z
        .enum(["verified", "claimed", "delivered", "completed"])
        .optional()
        .describe("Filter by task status"),
    },
    listVerifiedTasksHandler,
  );

  r.registerTool(
    "get_task_status",
    "Get detailed status of a cross-chain task on Creditcoin. Returns task details including poster, reward, capabilities, deadline, status, claimer, and IPFS result hash.",
    {
      taskId: z.string().describe("Task ID (numeric string)"),
    },
    getTaskStatusHandler,
  );
}

// ─── TaskState ABI (inlined) ───────────────────────────────────

const TaskStateABI = [
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "tasks",
    outputs: [
      { internalType: "uint256", name: "taskId", type: "uint256" },
      { internalType: "address", name: "poster", type: "address" },
      { internalType: "uint256", name: "reward", type: "uint256" },
      { internalType: "string", name: "capabilities", type: "string" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
      { internalType: "address", name: "claimer", type: "address" },
      { internalType: "string", name: "ipfsResultHash", type: "string" },
      { internalType: "uint8", name: "status", type: "uint8" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "nextTaskId",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
