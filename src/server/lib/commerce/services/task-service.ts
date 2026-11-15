/**
 * Task service — create/open/cancel + reads. Authz: any authenticated
 * wallet creates; only the buyer opens/cancels (D-224-3, slice authz).
 */
import type { CommerceTaskRow } from "@agentbadge/database";
import { idempotentWrite } from "../../contract-guards";
import {
  assertDecimal,
  assertIdempotencyKey,
  assertNonEmpty,
  assertSummary,
  assertWallet,
  newId,
} from "../guards";
import { forbidden, type TaskCreateInput } from "../types";
import { mustGet, transitionRow, type CommerceCtx } from "./ctx";

export interface TaskService {
  create(
    actorWallet: string,
    input: TaskCreateInput,
    idempotencyKey?: string,
  ): Promise<{ task: CommerceTaskRow; duplicate: boolean }>;
  open(actorWallet: string, taskId: string): Promise<CommerceTaskRow>;
  cancel(actorWallet: string, taskId: string): Promise<CommerceTaskRow>;
  get(taskId: string): Promise<CommerceTaskRow | null>;
  list(opts?: {
    status?: string;
    buyerWallet?: string;
    limit?: number;
  }): Promise<CommerceTaskRow[]>;
}

export function createTaskService(ctx: CommerceCtx): TaskService {
  const { stores, emit } = ctx;

  return {
    async create(actorWallet, input, idempotencyKey) {
      const buyer = assertWallet(actorWallet, "actorWallet");
      if (idempotencyKey !== undefined) {
        assertIdempotencyKey(idempotencyKey);
        const res = await idempotentWrite(
          "commerce.task.create",
          idempotencyKey,
          async () => {
            const task = await doCreate();
            return { status: 201, body: { task } };
          },
        );
        return {
          task: (res.body as { task: CommerceTaskRow }).task,
          duplicate: res.duplicate,
        };
      }
      const task = await doCreate();
      return { task, duplicate: false };

      async function doCreate(): Promise<CommerceTaskRow> {
        const title = assertNonEmpty(input.title, "title");
        const description = assertSummary(input.description, "description");
        if (input.budget !== undefined && input.budget !== null) {
          assertDecimal(input.budget, "budget");
        }
        const initial = input.status ?? "OPEN";
        if (initial !== "DRAFT" && initial !== "OPEN") {
          throw forbidden(`create status must be DRAFT or OPEN`);
        }
        const task = await stores.tasks.create({
          id: newId("ct"),
          buyerWallet: buyer,
          buyerAgentId: input.buyerAgentId ?? null,
          title,
          description,
          requirements: input.requirements ?? null,
          budget: input.budget ?? null,
          currency: input.currency ?? "USD",
          expiresAtMs: input.expiresAtMs ?? null,
          status: "DRAFT",
          payload: (input.payload ?? {}) as Record<string, never>,
        });
        if (!task) throw new Error("task id collision");
        await emit.emit({
          entityType: "task",
          entityId: task.id,
          eventType: "task.created",
          actorWallet: buyer,
          payload: { status: "DRAFT", title },
        });
        if (initial === "OPEN") {
          await transitionRow(ctx, "task", task, "OPEN", (from) =>
            stores.tasks.applyStatus(task.id, from, "OPEN"),
          );
        }
        return (await stores.tasks.getById(task.id))!;
      }
    },

    async open(actorWallet, taskId) {
      const actor = assertWallet(actorWallet, "actorWallet");
      const task = mustGet(await stores.tasks.getById(taskId), "task", taskId);
      if (task.buyerWallet !== actor) {
        throw forbidden("only the buyer can open a task");
      }
      return transitionRow(ctx, "task", task, "OPEN", (from) =>
        stores.tasks.applyStatus(task.id, from, "OPEN"),
      );
    },

    async cancel(actorWallet, taskId) {
      const actor = assertWallet(actorWallet, "actorWallet");
      const task = mustGet(await stores.tasks.getById(taskId), "task", taskId);
      if (task.buyerWallet !== actor) {
        throw forbidden("only the buyer can cancel a task");
      }
      const cancelled = await transitionRow(ctx, "task", task, "CANCELLED",
        (from) => stores.tasks.applyStatus(task.id, from, "CANCELLED"),
      );
      // cascade: an ACTIVE agreement on this task dies with it
      const agreement = await stores.agreements.getByTaskId(task.id);
      if (agreement && agreement.status === "ACTIVE") {
        await transitionRow(ctx, "agreement", agreement, "CANCELLED", (from) =>
          stores.agreements.applyStatus(agreement.id, from, "CANCELLED"),
        );
      }
      return cancelled;
    },

    get: (taskId) => stores.tasks.getById(taskId),
    list: (opts) => stores.tasks.list(opts),
  };
}
