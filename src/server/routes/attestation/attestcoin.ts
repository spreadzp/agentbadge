import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi";
import { z } from "zod";
import { JsonRpcProvider, Contract } from "ethers";

export const attestcoinRoutes = new Hono();

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
] as const;

const TASK_STATUS_NAMES = ["None", "Verified", "Claimed", "Delivered", "Completed"] as const;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

const taskSchema = z.object({
  taskId: z.string(),
  poster: z.string(),
  reward: z.string(),
  capabilities: z.string(),
  deadline: z.string(),
  status: z.string(),
  claimer: z.string().nullable(),
  ipfsResultHash: z.string().nullable(),
});

const taskListSchema = z.object({
  tasks: z.array(taskSchema),
});

const verifyResponseSchema = z.object({
  taskId: z.string(),
  verified: z.boolean(),
  txHash: z.string(),
});

const statusSchema = z.object({
  workerA: z.boolean(),
  workerB: z.boolean(),
  aiAgent: z.boolean(),
  attestcoinEnabled: z.boolean(),
});

interface AttestcoinRouteConfig {
  enabled: boolean;
  creditcoinRpcUrl: string;
  taskStateAddr: string;
}

let routeConfig: AttestcoinRouteConfig | null = null;

export function setAttestcoinRouteConfig(config: AttestcoinRouteConfig): void {
  routeConfig = config;
}

function getConfig(): AttestcoinRouteConfig {
  if (routeConfig) return routeConfig;
  return {
    enabled: process.env.ATTESTCOIN_ENABLED === "true",
    creditcoinRpcUrl: process.env.CREDITCOIN_RPC_URL ?? "https://rpc.cc3-testnet.creditcoin.network",
    taskStateAddr: process.env.TASK_STATE_ADDR ?? "",
  };
}

function getTaskStateContract(): Contract {
  const cfg = getConfig();
  const provider = new JsonRpcProvider(cfg.creditcoinRpcUrl);
  return new Contract(cfg.taskStateAddr, TaskStateABI, provider);
}

const workerStatus = {
  workerA: false,
  workerB: false,
  aiAgent: false,
};

export function setWorkerStatus(key: keyof typeof workerStatus, value: boolean): void {
  workerStatus[key] = value;
}

attestcoinRoutes.get(
  "/api/attestcoin/tasks",
  describeRoute({
    tags: ["Attestcoin"],
    summary: "List verified cross-chain tasks from Creditcoin TaskState",
    responses: {
      200: {
        description: "Task list",
        content: {
          "application/json": { schema: resolver(taskListSchema) },
        },
      },
      503: { description: "Attestcoin not enabled" },
    },
  }),
  async (c) => {
    const cfg = getConfig();
    if (!cfg.enabled) {
      return c.json({ error: "Attestcoin not enabled" }, 503);
    }

    try {
      const state = getTaskStateContract();
      // Sequential read: try tasks(1), tasks(2), ... until None status or max limit
      // (queryFilter times out on Creditcoin RPC due to large block range)
      const MAX_TASKS = 100;
      const tasks: z.infer<typeof taskSchema>[] = [];

      for (let i = 1n; i <= BigInt(MAX_TASKS); i++) {
        const task = await state.tasks(i);
        if (Number(task.status) === 0) break; // None = no more tasks

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

      return c.json({ tasks }, 200);
    } catch (err) {
      return c.json({ error: "Failed to fetch tasks", detail: String(err) }, 500);
    }
  },
);

attestcoinRoutes.get(
  "/api/attestcoin/tasks/:taskId",
  describeRoute({
    tags: ["Attestcoin"],
    summary: "Get single task details from Creditcoin TaskState",
    responses: {
      200: {
        description: "Task details",
        content: {
          "application/json": { schema: resolver(taskSchema) },
        },
      },
      404: { description: "Task not found" },
      503: { description: "Attestcoin not enabled" },
    },
  }),
  async (c) => {
    const cfg = getConfig();
    if (!cfg.enabled) {
      return c.json({ error: "Attestcoin not enabled" }, 503);
    }

    const taskIdStr = c.req.param("taskId");
    const taskId = BigInt(taskIdStr);

    try {
      const state = getTaskStateContract();
      const task = await state.tasks(taskId);

      if (Number(task.status) === 0) {
        return c.json({ error: "Task not found" }, 404);
      }

      return c.json({
        taskId: taskIdStr,
        poster: task.poster,
        reward: task.reward.toString(),
        capabilities: task.capabilities,
        deadline: task.deadline.toString(),
        status: TASK_STATUS_NAMES[Number(task.status)] ?? "Unknown",
        claimer: task.claimer === ZERO_ADDR ? null : task.claimer,
        ipfsResultHash: task.ipfsResultHash === "" ? null : task.ipfsResultHash,
      }, 200);
    } catch (err) {
      return c.json({ error: "Failed to fetch task", detail: String(err) }, 500);
    }
  },
);

attestcoinRoutes.post(
  "/api/attestcoin/verify",
  describeRoute({
    tags: ["Attestcoin"],
    summary: "Manually trigger verification for a Sepolia tx hash",
    responses: {
      200: {
        description: "Verification result",
        content: {
          "application/json": { schema: resolver(verifyResponseSchema) },
        },
      },
      400: { description: "Invalid txHash" },
      503: { description: "Attestcoin not enabled" },
    },
  }),
  async (c) => {
    const cfg = getConfig();
    if (!cfg.enabled) {
      return c.json({ error: "Attestcoin not enabled" }, 503);
    }

    const body = await c.req.json().catch(() => ({}));
    const txHash = body?.txHash;

    if (!txHash || typeof txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      return c.json({ error: "Invalid txHash" }, 400);
    }

    return c.json({
      taskId: "0",
      verified: false,
      txHash,
    }, 200);
  },
);

attestcoinRoutes.get(
  "/api/attestcoin/status",
  describeRoute({
    tags: ["Attestcoin"],
    summary: "Returns worker status (Worker A, Worker B, AI Agent)",
    responses: {
      200: {
        description: "Worker status",
        content: {
          "application/json": { schema: resolver(statusSchema) },
        },
      },
    },
  }),
  (c) => {
    const cfg = getConfig();
    return c.json({
      workerA: workerStatus.workerA,
      workerB: workerStatus.workerB,
      aiAgent: workerStatus.aiAgent,
      attestcoinEnabled: cfg.enabled,
    }, 200);
  },
);
