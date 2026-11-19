# EPIC-234 candidates — triaged from EPIC-255 conformance run

Source: `tests/conformance/mmf/results/{spend,lifecycle,own-invariants}.json`.
All reproduce under the REAL enforcer/ledger — no fixes here, audit only.

## P1 — unsafe amounts are reserved (spend track, 4 vectors)

**Repro:** `V04, V17, V29, V33` — `amountUsd` of `0`, `-50`, `"10"`
(string), `-0` all produce a `reserved` ledger entry; the gate
returns allow where any amount-validity check must deny.
**Code:** `src/server/lib/agent-wallet/envelope.ts::insertReserved`
+ `enforcer.ts::begin` — no `amountUsd > 0 && Number.isFinite` gate
anywhere before reserve.
**Fix class:** amount-validity branch (first cap check): finite,
positive, within integer-safe range → else 402 + denied entry.

## P1 — check-then-insert TOCTOU overshoot (own-invariant OWN-1)

**Repro:** `runRaceProbe` — 8 parallel begins vs dailyUsd $100 →
8/8 reserved ($160, +$60); memory backend N=32 → 32/32 ($320, +$220).
Sequential baseline is correct (5/8, 10/32) — race, not bad math.
**Code:** `enforcer.ts` — `checkEnvelope(listByWallet)` then
`insertReserved(insert)` as separate awaits; comment at
`envelope.ts:194-200` claims sync backends can't interleave —
empirically false (microtask interleaving across coroutines).
**Fix class:** atomic check+insert — conditional insert keyed on
window sum (SQL `INSERT ... WHERE`), per-wallet mutex, or
serializable txn on the db backend.

## P1 — corrupted-JSON ledger fails OPEN + clobbers (OWN-2)

**Repro:** garbage `ledger.json` → `readJson` catch → `entries={}` →
all caps see zero usage → spend allowed; next `insert` → `writeJson`
**overwrites** the file — history silently destroyed.
**Code:** `src/server/lib/agent-wallet/ledger.ts:115-127` (`readJson`
swallows parse errors), `:125` (`writeJson` unconditional).
**Fix class:** fail-closed on unreadable ledger (json backend), or
quarantine corrupt file + alert + deny until repaired.

## P2 — tx_id/refId is never a dedup key (OWN-4 + L01–L03, L27, L29)

**Repro:** same `tx_id` twice → two `reserved` entries with fresh
`sp_` ids; same params / changed amount / changed payee / post-settle
/ post-void all re-decide. Client retry = double-charge on caps.
**Code:** `ledger.ts::insert` idempotent only on entry `id`
(sp_ uuid), never consulted on `refId`. All callers use static or
random refIds (`x402:{METHOD} {path}`, `bstock:{serviceId}`,
`buyfx:{pair}`, `sub:{id}`, `{kind}:{random}`).
**Fix class:** caller idempotency key → ledger unique index +
stored-decision lookup (MMF REPLAY semantic as the target).

## P2 — velocity-void evasion (lifecycle L05, L09)

**Repro:** authorize→void→authorize cycle: `released` entries drop
out of `windowCount` → the velocity slot frees → rate limit evadable
indefinitely. MMF counts *issued authorizations*, not live ones.
**Code:** `src/server/lib/agent-wallet/window.ts:24,49` — state
filter `reserved|settled` excludes `released`.
**Fix class:** velocity window counts issuances (separate counter or
include released within window) — release frees $ cap-space but not
the tx-count slot.

## P2 — deny paths without evidence (OWN-3 + V21, L24)

**Repro:** `not-registered` (402 via errorResponse) and
`registry-throw` (500) leave **no ledger entry and no alert**;
repeated probes show it's a class, not a one-off.
**Code:** `enforcer.ts:100-118` (early returns bypass all emitters);
`registry.get` throw propagates raw through `begin`.
**Fix class:** every deny path emits durable denied entry + alert;
registry failure → fail-closed 500 **with** deny-evidence attempt.

## P3 — delegate clamp-vs-reject (delegation D03–D12, question open)

**Repro:** `spendAsDelegate` clamps request to owner cap where MMF
expects `invalid` verdict; 13 of 18 delegation vectors diverge on
this. Recorded as MODEL — semantic question to Shedrack (MAPPING §4).
**Code:** `src/server/lib/agent-wallet/delegate.ts`.
**Fix class:** if `invalid` is normative → reject over-cap delegate
spend instead of clamping.

## P3 — no claim/dispatch-slot, settle without handshake (MODEL)

**Repro:** `settleEntry` moves reserved→settled directly (L25);
`releaseEntry` voids without `cancellation` ref (L26); CLAIM:*
check-ids unreachable (L21–L23).
**Code:** `ledger.ts::transition` — no claim state machine.
**Fix class:** if MMF claim semantics adopted → dispatch-slot state
+ op-scoped deny reasons (SETTLE:*, VOID:*, CLAIM:*).

## Info — spendAsDelegate not wired

`spendAsDelegate` has **no production call sites** — library + tests
only (grep: routes reference it in a comment). Either wire it or
mark the API surface experimental.

---

*Generated 2026-11-19 by SLICE-255-6. Repro details per finding in
`tests/conformance/mmf/results/`.*
