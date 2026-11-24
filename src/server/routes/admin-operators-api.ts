/**
 * EPIC-264 (SLICE-264-4): operator lifecycle JSON API —
 *   GET  /admin/api/operators                          list (+ cred meta)
 *   POST /admin/api/operators                          create
 *   POST /admin/api/operators/:id/credentials          issue (key ONCE)
 *   POST /admin/api/operators/:id/credentials/:cid/{revoke,rotate}
 *   POST /admin/api/operators/:id/{disable,enable}
 *
 * First surface mounted behind operatorAuth (D-264-Q2): the caller IS
 * the credential — there is no x-operator-id (it 400s at the boundary)
 * and no shared-key bypass on purpose: a shared-key holder must never
 * mint operator credentials. Capability operator-admin comes from the
 * operator record (C7).
 *
 * Plaintext hygiene: the minted opk_ key appears in a JSON response
 * exactly once — never in list output (no keyHash either), never in
 * logs, never in flash params.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { operatorAuth, getPrincipal } from "../middleware/operatorAuth";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { rejectCtrl } from "./admin-operator-guard";
import {
  auditOperatorAdmin,
  credMeta,
  opMeta,
  operatorAdminGate,
  reasonStatus,
  runOperatorWrite,
} from "./admin-operators-shared";
import type { OperatorStore } from "../lib/operators";
import {
  createOperator,
  ADMIN_CAPABILITIES,
} from "../lib/operators";
import { registerOperatorCredentialRoutes } from "./admin-operators-api-credentials";

const createBodySchema = z.object({
  id: z.string().max(80).optional(),
  displayName: z.string().min(1).max(200),
  principalType: z.enum(["human", "service", "break_glass"]),
  capabilities: z.array(z.string().max(40)).max(16).optional(),
});

export function createAdminOperatorsApi(store: OperatorStore): Hono {
  const app = new Hono();
  app.use("/admin/api/operators", operatorAuth(store), operatorAdminGate);
  app.use(
    "/admin/api/operators/*",
    operatorAuth(store),
    operatorAdminGate,
  );

  app.get(
    "/admin/api/operators",
    describeRoute({
      summary: "List operators + credential metadata (no key material)",
      tags: ["Admin Operators"],
      responses: {
        200: { description: "{operators:[{...,credentials:[meta]}]}" },
        401: { description: "Missing/invalid operator credential" },
        403: { description: "INSUFFICIENT_CAPABILITY operator-admin" },
      },
    }),
    async (c) => {
      const operators = await store.listOperators();
      const rows = await Promise.all(
        operators.map(async (o) => ({
          ...opMeta(o),
          credentials: (
            await store.listCredentialsForOperator(o.id)
          ).map(credMeta),
        })),
      );
      return c.json({ operators: rows });
    },
  );

  app.post(
    "/admin/api/operators",
    describeRoute({
      summary: "Create an operator (identity only — issue a key after)",
      tags: ["Admin Operators"],
      responses: {
        200: { description: "{operator}" },
        400: { description: "Validation failure" },
        409: { description: "duplicate_display_name / duplicate_id" },
      },
    }),
    async (c) => {
      const actor = getPrincipal(c)!;
      const raw = await c.req.json().catch(() => null);
      const body = createBodySchema.safeParse(raw);
      if (!body.success) {
        return errorResponse(
          c, 400, ErrorCodes.INVALID_INPUT, "bad operator body",
        );
      }
      const caps = body.data.capabilities ?? ["read", "workflow"];
      if (caps.some((cap) => !ADMIN_CAPABILITIES.includes(cap as never))) {
        return errorResponse(
          c, 400, ErrorCodes.INVALID_INPUT,
          `capabilities ⊆ ${ADMIN_CAPABILITIES.join(",")}`,
        );
      }
      return runOperatorWrite(
        c,
        "POST:/admin/api/operators",
        async () => {
          const r = await createOperator(store, {
            id: body.data.id,
            displayName: body.data.displayName,
            principalType: body.data.principalType,
            capabilities: caps,
          });
          if (!r.ok) {
            return {
              status:
                r.reason === "duplicate_display_name" ||
                r.reason === "duplicate_id"
                  ? 409
                  : 400,
              body: { error: { code: r.reason, message: r.reason } },
            };
          }
          auditOperatorAdmin(actor, "operator_create", r.operator.id, {
            principalType: r.operator.principalType,
          });
          return { status: 200, body: { operator: opMeta(r.operator) } };
        },
        { owner: actor.id, body: body.data },
      );
    },
  );

  registerOperatorCredentialRoutes(app, store);

  for (const verb of ["disable", "enable"] as const) {
    app.post(
      `/admin/api/operators/:id/${verb}`,
      describeRoute({
        summary: `${verb === "disable" ? "Disable" : "Enable"} an operator (C5-guarded, idempotent)`,
        tags: ["Admin Operators"],
        responses: {
          200: { description: "{operator}" },
          404: { description: "missing" },
          409: { description: "last_operator" },
        },
      }),
      async (c) => {
        const actor = getPrincipal(c)!;
        const id = c.req.param("id") ?? "";
        const ctrlBad = rejectCtrl(c, id);
        if (ctrlBad) return ctrlBad;
        return runOperatorWrite(
          c,
          `POST:/admin/api/operators/${id}/${verb}`,
          async () => {
            const r =
              verb === "disable"
                ? await store.disableOperator(id)
                : await store.enableOperator(id);
            if (!r.ok) {
              if (r.reason === "last_operator") {
                auditOperatorAdmin(
                  actor, `operator_${verb}_refused`, id,
                  { reason: r.reason },
                );
              }
              return {
                status: reasonStatus(r.reason),
                body: { error: { code: r.reason, message: r.reason } },
              };
            }
            auditOperatorAdmin(actor, `operator_${verb}`, id);
            return { status: 200, body: { operator: opMeta(r.operator) } };
          },
          { owner: actor.id, resource: id, body: {} },
        );
      },
    );
  }

  return app;
}
