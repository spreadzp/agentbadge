/**
 * EPIC-264 (SLICE-264-4): operators SSR console —
 *   GET  /admin/operators                 → operator+cred table + forms
 *   POST /admin/operators/{create,:id/*}  → PRG mutations (303 → flash)
 *
 * Browser auth: `operatorBrowserAuth` — a browser answers the Basic
 * challenge with the operator's opk_ key as password; identity comes
 * from the credential (NO shared-key fallback, NO x-operator-id —
 * both die at the middleware boundary, D-264-Q16). POSTs require
 * same-host Origin/Sec-Fetch-Site (B-3 lesson, knowledge console
 * precedent); forms carry render-minted single-use tokens.
 *
 * New keys are shown ONCE via a server-side reveal slot (?reveal= is
 * an opaque token, consumed on first render, bound to the minting
 * principal) — the plaintext never travels in a URL, flash param,
 * or log line (C11).
 */

import { Hono } from "hono";
import type { Context } from "hono";

import {
  operatorBrowserAuth,
  requireCapability,
  requirePrincipal,
} from "../middleware/operatorAuth";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { rejectCtrl } from "./admin-operator-guard";
import { wrapFragment } from "./ui/helpers";
import type { OperatorStore } from "../lib/operators";
import {
  createOperator,
  issueOperatorCredential,
  rotateOperatorCredential,
  ADMIN_CAPABILITIES,
  ADMIN_PRINCIPAL_TYPES,
} from "../lib/operators";
import { consumeFormToken } from "../lib/knowledge/form-tokens";
import { consumeKeyReveal, mintKeyReveal } from "../lib/operators/key-reveal";
import { auditOperatorAdmin } from "./admin-operators-shared";
import {
  operatorsPage,
  type OperatorRow,
} from "../../views/admin-operators/list";

const FORM_TOKEN_ERR = "form_expired_or_duplicate";
const tokenConsumed = (b: Record<string, unknown>): boolean =>
  consumeFormToken(
    typeof b.formToken === "string" ? b.formToken.trim() : "",
  );

const page = (c: Context, frag: string): Response =>
  c.html(
    wrapFragment(c, frag, "Operators", {
      path: c.req.path,
      title: "Admin Operators",
      description: "Admin Operators",
    }),
    200,
    { "Cache-Control": "no-store", Vary: "HX-Request" },
  );

const backWith = (flash: { ok?: string; err?: string; reveal?: string }): string => {
  const q = new URLSearchParams();
  if (flash.err) q.set("err", flash.err.slice(0, 120));
  else if (flash.ok) q.set("ok", flash.ok.slice(0, 120));
  if (flash.reveal) q.set("reveal", flash.reveal);
  const qs = q.toString();
  return `/admin/operators${qs ? `?${qs}` : ""}`;
};

export function createAdminOperatorsUi(store: OperatorStore): Hono {
  const app = new Hono();
  app.use("/admin/operators", operatorBrowserAuth(store));
  app.use("/admin/operators/*", operatorBrowserAuth(store));
  // B-3: browsers auto-attach cached Basic creds to cross-site form
  // POSTs — Sec-Fetch-Site/Origin checked when present (knowledge
  // console precedent).
  app.use("/admin/operators/*", async (c, next) => {
    if (c.req.method !== "POST") return next();
    if (c.req.header("sec-fetch-site") === "cross-site") {
      return errorResponse(
        c, 403, ErrorCodes.UNAUTHORIZED, "cross-site form post refused",
      );
    }
    const origin = c.req.header("origin");
    if (!origin) return next();
    try {
      if (new URL(origin).host === new URL(c.req.url).host) return next();
    } catch {
      /* malformed origin → refuse below */
    }
    return errorResponse(
      c, 403, ErrorCodes.UNAUTHORIZED, "cross-origin form post refused",
    );
  });

  app.get("/admin/operators", async (c) => {
    const deny = requireCapability(c, "operator-admin");
    if (deny) return deny;
    const actor = requirePrincipal(c);
    if (actor instanceof Response) return actor;
    const operators = await store.listOperators();
    const rows: OperatorRow[] = await Promise.all(
      operators.map(async (o) => ({
        operator: o,
        credentials: await store.listCredentialsForOperator(o.id),
      })),
    );
    const revealParam = c.req.query("reveal");
    const res = page(
      c,
      operatorsPage({
        rows,
        capabilities: ADMIN_CAPABILITIES,
        principalTypes: ADMIN_PRINCIPAL_TYPES,
        reveal: consumeKeyReveal(revealParam ?? "", actor.id),
        flash: { ok: c.req.query("ok"), err: c.req.query("err") },
      }),
    );
    // a reveal page suppresses Referer on outbound navigations — the
    // (already spent) token must not land in durable traffic logs via
    // the next same-origin click's referer field.
    if (revealParam) res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  });

  app.post("/admin/operators/create", async (c) => {
    const deny = requireCapability(c, "operator-admin");
    if (deny) return deny;
    const actor = requirePrincipal(c);
    if (actor instanceof Response) return actor;
    const b = await c.req.parseBody();
    const str = (k: string) =>
      typeof b[k] === "string" ? (b[k] as string).trim() : "";
    // ctrl-chars checked BEFORE the token is consumed — a poisoned
    // field must not burn the single-use token; and the answer rides
    // the same 303+flash channel as every sibling, not a bare JSON
    // 400 on an HTML surface.
    const bad = rejectCtrl(c, str("displayName"), str("principalType"));
    if (bad) {
      return c.redirect(backWith({ err: "bad_input" }), 303);
    }
    if (!tokenConsumed(b)) {
      return c.redirect(backWith({ err: FORM_TOKEN_ERR }), 303);
    }
    const principalType = str("principalType");
    if (!ADMIN_PRINCIPAL_TYPES.includes(principalType as never)) {
      return c.redirect(backWith({ err: "bad_principal_type" }), 303);
    }
    const caps = ADMIN_CAPABILITIES.filter((cap) => b[`cap_${cap}`] === "on");
    const r = await createOperator(store, {
      displayName: str("displayName"),
      principalType: principalType as never,
      capabilities: caps.length > 0 ? caps : ["read", "workflow"],
    });
    if (!r.ok) return c.redirect(backWith({ err: r.reason }), 303);
    auditOperatorAdmin(actor, "operator_create", r.operator.id, {
      principalType: r.operator.principalType, via: "ui",
    });
    return c.redirect(backWith({ ok: `created_${r.operator.id}` }), 303);
  });

  app.post("/admin/operators/:id/credentials", async (c) => {
    const deny = requireCapability(c, "operator-admin");
    if (deny) return deny;
    const actor = requirePrincipal(c);
    if (actor instanceof Response) return actor;
    const id = c.req.param("id") ?? "";
    const b = await c.req.parseBody();
    const bad = rejectCtrl(c, id);
    if (bad) return bad;
    if (!tokenConsumed(b)) {
      return c.redirect(backWith({ err: FORM_TOKEN_ERR }), 303);
    }
    const r = await issueOperatorCredential(store, id);
    if (!r.ok) return c.redirect(backWith({ err: r.reason }), 303);
    auditOperatorAdmin(actor, "credential_issue", r.credential.id, {
      operatorId: id, via: "ui",
    });
    return c.redirect(
      backWith({ reveal: mintKeyReveal(r.key, actor.id) }),
      303,
    );
  });

  for (const verb of ["revoke", "rotate"] as const) {
    app.post(`/admin/operators/:id/credentials/:cid/${verb}`, async (c) => {
      const deny = requireCapability(c, "operator-admin");
      if (deny) return deny;
      const actor = requirePrincipal(c);
    if (actor instanceof Response) return actor;
      const id = c.req.param("id") ?? "";
      const cid = c.req.param("cid") ?? "";
      const b = await c.req.parseBody();
      const bad = rejectCtrl(c, id, cid);
      if (bad) return bad;
      if (!tokenConsumed(b)) {
        return c.redirect(backWith({ err: FORM_TOKEN_ERR }), 303);
      }
      if (verb === "revoke") {
        const cred = (await store.listCredentialsForOperator(id)).find(
          (x) => x.id === cid,
        );
        if (!cred) return c.redirect(backWith({ err: "missing" }), 303);
        const r = await store.revokeCredential(cid);
        if (!r.ok) {
          // refused lockout attempts ARE the audit signal
          if (r.reason === "last_operator") {
            auditOperatorAdmin(actor, "credential_revoke_refused", cid, {
              operatorId: id, reason: r.reason, via: "ui",
            });
          }
          return c.redirect(backWith({ err: r.reason }), 303);
        }
        auditOperatorAdmin(actor, "credential_revoke", cid, {
          operatorId: id, via: "ui",
        });
        return c.redirect(backWith({ ok: `revoked_${cid}` }), 303);
      }
      const r = await rotateOperatorCredential(store, id, cid);
      if (!r.ok) {
        return c.redirect(
          backWith({
            err: r.reason,
            // an issued-but-unrevoked key must still be reachable once
            ...("key" in r && r.key
              ? { reveal: mintKeyReveal(r.key, actor.id) }
              : {}),
          }),
          303,
        );
      }
      auditOperatorAdmin(actor, "credential_rotate", cid, {
        operatorId: id, newCredential: r.credential.id, via: "ui",
      });
      return c.redirect(backWith({ reveal: mintKeyReveal(r.key, actor.id) }), 303);
    });
  }

  for (const verb of ["disable", "enable"] as const) {
    app.post(`/admin/operators/:id/${verb}`, async (c) => {
      const deny = requireCapability(c, "operator-admin");
      if (deny) return deny;
      const actor = requirePrincipal(c);
    if (actor instanceof Response) return actor;
      const id = c.req.param("id") ?? "";
      const b = await c.req.parseBody();
      const bad = rejectCtrl(c, id);
      if (bad) return bad;
      if (!tokenConsumed(b)) {
        return c.redirect(backWith({ err: FORM_TOKEN_ERR }), 303);
      }
      const r =
        verb === "disable"
          ? await store.disableOperator(id)
          : await store.enableOperator(id);
      if (!r.ok) {
        if (r.reason === "last_operator") {
          auditOperatorAdmin(actor, `operator_${verb}_refused`, id, {
            reason: r.reason, via: "ui",
          });
        }
        return c.redirect(backWith({ err: r.reason }), 303);
      }
      auditOperatorAdmin(actor, `operator_${verb}`, id, { via: "ui" });
      return c.redirect(backWith({ ok: `${verb}d_${id}` }), 303);
    });
  }

  return app;
}
