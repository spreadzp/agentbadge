# RUNBOOK — Break-glass (EPIC-264, SLICE-264-9)

`ADMIN_API_KEY` is an **emergency credential, not an auth path**. Admin
surfaces authenticate `opk_` operator credentials; the shared key works
**only** while `ADMIN_BREAK_GLASS_ENABLED=true`, and every accepted use:

- authenticates as the synthetic principal `break_glass`
  (`principalType: "break_glass"`) — visible in audit rows as
  `break_glass`, never a person;
- emits `operator_admin.break_glass USE` at **warn** level with the
  request surface (wire this log key to alerting);
- increments `agentbadge_admin_breakglass_auth_total{surface}` — any
  nonzero value outside a declared incident is a pager.

Boot logs the posture once: `operators: BREAK-GLASS armed` (warn) or
`break-glass disarmed` (info).

## When to use

The shared key exists for one scenario: **all operator credentials are
unusable** (lost, revoked en masse, operator store corrupted) and you
must reach an admin surface to restore access. If any personal `opk_`
still works, do NOT arm break-glass — use it instead.

## Arm

1. Set in the service env and restart:

   ```
   ADMIN_API_KEY=<the shared secret>
   ADMIN_BREAK_GLASS_ENABLED=true
   ```

2. Confirm the boot log shows `operators: BREAK-GLASS armed`.

3. Call the admin surface with the key in `X-Admin-Key` or
   `Authorization: Bearer` (Basic password also works on SSR consoles).
   Audit rows will read `break_glass` — that marking is the point.

## Disarm — REQUIRED after the incident

Break-glass left armed is a silent second admin. After recovery:

1. `ADMIN_BREAK_GLASS_ENABLED=false` (or unset) and restart.
2. Verify boot log shows `break-glass disarmed`.
3. Verify a shared-key call now returns 401.
4. Review `agentbadge_admin_breakglass_auth_total` and the warn log —
   every surface touched during the window is listed; reconcile with
   the incident timeline and the `break_glass` audit rows.
5. Rotate `ADMIN_API_KEY` if its use was not fully accounted for.

## Preferred recovery — `operator:create` (no break-glass at all)

If you have shell access to the deployment env, mint a real credential
instead — break-glass never needs to be armed:

```
bun run operator:create -- --name alice --caps read,workflow,operator-admin
```

Prints the `opk_` plaintext **once** — it is never stored and never
shown again. Requirements:

- `DATABASE_ENABLED=true` and an installed `@agentbadge/database` that
  carries the `adminOperators` group — the CLI refuses a memory
  backend (rows would die with the process).
- For `DATABASE_ENABLED=off` dev, use `OPERATOR_SEED_JSON` at boot
  instead (`.env.example`) — it seeds the first operator when the
  table is empty.

Then authenticate with the new `opk_` and disable/revoke whatever
credentials caused the incident via `/admin/operators` or
`/admin/api/operators/*`.

## What the shared key can NOT do

The `break_glass` principal carries `read` + `workflow` only —
**never** `operator-admin`. It cannot create, rotate, or revoke
operator credentials. To restore operator access you either use
`operator:create` (shell) or a still-valid `operator-admin` `opk_`.
