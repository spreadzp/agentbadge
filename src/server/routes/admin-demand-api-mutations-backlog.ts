/**
 * EPIC-231 (SLICE-231-11 split): POST /api/admin/demand/opportunities/:id/backlog
 * — «→ Backlog task» export (ACCEPTED → LINKED + card file).
 * Split out of admin-demand-api-mutations-opportunities.ts for the
 * 300-line cap; same register() convention.
 */

import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { principalId } from "../middleware/operatorAuth";
import {
  defaultBacklogWriter,
  linkDemandBacklog,
  type BacklogTaskWriter,
} from "../lib/demand/backlog-export";
import type { DemandStore } from "../lib/demand/store";
import {
  rejectCtrl,
  requestFingerprint,
  runKnowledgeWrite,
} from "./admin-operator-guard";

export interface DemandBacklogRouteDeps {
  /** 231-8: «→ Backlog task» writer factory (default: FS/env). */
  backlogWriter?: () => BacklogTaskWriter;
}

export function registerDemandBacklogMutation(
  app: Hono,
  store: DemandStore,
  deps: DemandBacklogRouteDeps = {},
): void {
  app.post(
    "/api/admin/demand/opportunities/:id/backlog",
    describeRoute({
      summary:
        "«→ Backlog task» — export ACCEPTED opportunity as a Backlog.md task (idempotent)",
      tags: ["Admin Demand"],
      responses: {
        200: { description: "Linked (or already-linked) opportunity + taskId" },
        400: { description: "Validation/idempotency failure" },
        404: { description: "Unknown opportunity" },
        409: { description: "Not ACCEPTED / link raced" },
        502: { description: "Backlog tasks dir unwritable" },
      },
    }),
    async (c) => {
      const ctrlBad = rejectCtrl(c, c.req.param("id"));
      if (ctrlBad) return ctrlBad;
      const actor = principalId(c);
      if (actor instanceof Response) return actor;
      return runKnowledgeWrite(
        c,
        "POST:/api/admin/demand/opportunities/:id/backlog",
        async () => {
          const writer = deps.backlogWriter ?? defaultBacklogWriter;
          const r = await linkDemandBacklog(
            store,
            c.req.param("id"),
            actor,
            { writer: writer() },
          );
          if (!r.ok) {
            const status =
              r.reason === "missing"
                ? 404
                : r.reason === "write_failed"
                  ? 502
                  : 409;
            return {
              status,
              body: {
                error: {
                  code:
                    r.reason === "missing"
                      ? "REQUEST_NOT_FOUND"
                      : r.reason === "write_failed"
                        ? "BACKLOG_WRITE_FAILED"
                        : "ILLEGAL_TRANSITION",
                  message: `backlog export refused (${r.reason})`,
                },
              },
            };
          }
          return {
            status: 200,
            body: {
              opportunity: r.opportunity,
              taskId: r.taskId,
              alreadyLinked: r.alreadyLinked,
              ...(r.event ? { event: r.event } : {}),
            },
          };
        },
        {
          owner: actor,
          fingerprint: requestFingerprint({ id: c.req.param("id") }),
        },
      );
    },
  );
}
