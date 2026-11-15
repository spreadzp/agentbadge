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
    /** H1: sha256 of the signed request body — binds the dedupe entry. */
    bodyFingerprint?: string,
  ): Promise<{ task: CommerceTaskRow; duplicate: boolean }>;
  open(actorWallet: string, taskId: string): Promise<CommerceTaskRow>;
  cancel(actorWallet: string, taskId: string): Promise<CommerceTaskRow>;
  get(taskId: string): Promise<CommerceTaskRow | null>;
  list(opts?: {
    status?: string;
    buyerWallet?: string;
    limit?: number;
    /** H4: when set, DRAFT rows only visible to this wallet. */
    visibleTo?: string;
  }): Promise<CommerceTaskRow[]>;
}

export function createTaskService(ctx: CommerceCtx): TaskService {
  const { stores, emit } = ctx;

  return {
    async create(actorWallet, input, idempotencyKey, bodyFingerprint) {
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
          { owner: buyer, fingerprint: bodyFingerprint },
        );
        return {
          task: (res.body as { task: CommerceTaskRow }).task,
          duplicate: res.duplicate,
        };
      }
      const task = await doCreate();
      return { task, duplicate: false };

      async function doCreate(): Promise<CommerceTaskRow> {
        return stores.atomic(async (tx) => {
          const txCtx = { ...ctx, stores: tx };
          const title = assertNonEmpty(input.title, "title");
          const description = assertSummary(input.description, "description");
          if (input.budget !== undefined && input.budget !== null) {
            assertDecimal(input.budget, "budget");
          }
          const initial = input.status ?? "OPEN";
          if (initial !== "DRAFT" && initial !== "OPEN") {
            throw forbidden(`create status must be DRAFT or OPEN`);
          }
          const task = await tx.tasks.create({
            id: newId("ct"),
            buyerWallet: buyer,
            // H5: agentId is an unverifiable self-claim — never stored in
            // the typed column (would be presented as verified linkage);
            // kept in payload as a *claim* for display only.
            buyerAgentId: null,
            title,
            description,
            requirements: input.requirements ?? null,
            budget: input.budget ?? null,
            currency: input.currency ?? "USD",
            expiresAtMs: input.expiresAtMs ?? null,
            status: "DRAFT",
            payload: {
              ...(input.payload && typeof input.payload === "object"
                ? (input.payload as Record<string, unknown>)
                : {}),
              ...(input.buyerAgentId
                ? { claimedBuyerAgentId: input.buyerAgentId }
                : {}),
            } as Record<string, never>,
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
            await transitionRow(txCtx, "task", task, "OPEN", (from) =>
              tx.tasks.applyStatus(task.id, from, "OPEN"),
            );
          }
          return (await tx.tasks.getById(task.id))!;
        });
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
      // Atomic cascade (C1-adjacent): task + ACTIVE agreement + all
      // still-PENDING offers settle together — no state where the task
      // is CANCELLED but an offer remains PENDING-able to accept.
      return stores.atomic(async (tx) => {
        const txCtx = { ...ctx, stores: tx };
        const task = mustGet(await tx.tasks.getById(taskId), "task", taskId);
        if (task.buyerWallet !== actor) {
          throw forbidden("only the buyer can cancel a task");
        }
        const cancelled = await transitionRow(txCtx, "task", task, "CANCELLED",
          (from) => tx.tasks.applyStatus(task.id, from, "CANCELLED"),
          { actorWallet: actor },
        );
        // cascade 1: an ACTIVE agreement on this task dies with it
        const agreement = await tx.agreements.getByTaskId(task.id);
        if (agreement && agreement.status === "ACTIVE") {
          await transitionRow(txCtx, "agreement", agreement, "CANCELLED", (from) =>
            tx.agreements.applyStatus(agreement.id, from, "CANCELLED"),
            { actorWallet: actor },
          );
        }
        // cascade 2: every still-PENDING offer on the task → REJECTED
        for (const offer of await tx.offers.listByTask(task.id)) {
          if (offer.status !== "PENDING") continue;
          await transitionRow(txCtx, "offer", offer, "REJECTED", (from) =>
            tx.offers.applyStatus(offer.id, from, "REJECTED"),
            {
              actorWallet: actor,
              payload: { reason: "task_cancelled" },
            },
          );
        }
        return cancelled;
      });
    },

    get: (taskId) => stores.tasks.getById(taskId),
    list: (opts) => stores.tasks.list(opts),
  };
}
