# MMF Conformance — consolidated report

Corpus: Mandata MMF **v0.4.24** (pin: tag, sha256 in
report.json). Generated from results/{spend,lifecycle,crypto,
own-invariants}.json — deterministic, re-runnable.

Principle: *we test the implementation we actually have, not the
implementation we wish we had.* Production was not changed to conform.

## Metrics (separate per decision)

| Metric | n | Status | Equivalence |
|---|---|---|---|
| spend-decision | 36 | PASS 20 · DIVERGENCE-BUG 5 · DIVERGENCE-MODEL 3 · NOT_MAPPABLE 7 · GATE_EXCEPTION 1 | Exact 7 · Partial 8 · None 21 |
| delegation | 18 | PASS 5 · DIVERGENCE-MODEL 12 · NOT_MAPPABLE 1 | None 18 |
| lifecycle | 29 | PASS 2 · DIVERGENCE-BUG 2 · DIVERGENCE-MODEL 17 · NOT_MAPPABLE 7 · GATE_EXCEPTION 1 | None 29 |
| crypto-evidence | 9 | PASS 9 | None 9 |
| own-invariants | — | probes, not vectors | — |

Crypto PASS = test-lib canonicalizer byte-exact vs §5.6/§7 — prod has
no Ed25519 credential model nor evidence hash chain (prod-side dims None; canonical_form Partial).

## Divergences — BUG class (candidates for EPIC-234)

- **V04** — non-positive amount
- **V17** — negative amount rejected
- **V29** — decimal string amount is not accepted on the wire
- **V33** — amount token -0 is zero: not positive, so NON_POSITIVE
- **V36** — unpaired surrogate in a canonical string field — malformed input rejected before evaluation; no decision, no evidence record. (The JSON escape below decodes to 
- **L05** — void releases the reserved budget but NOT the velocity slot: velocity counts authorizations issued, so authorize-and-void cycling cannot evade the rate limit
- **L09** — a denial replays as the same denial even after the cause is gone

## Divergences — MODEL class (intentional deltas, discussion for note)

- No stored decisions / tx_id dedup — replay re-reserves (REPLAY and
  TX_CONFLICT unemittable). Majority of lifecycle MODEL count.
- No claim/dispatch-slot — settle direct from reserved; CLAIM:*
  check-ids unreachable; `cancellation` gate absent.
- Delegate clamp-vs-reject: spendAsDelegate clamps to owner cap
  where MMF expects `invalid`.
- Velocity window: MMF 86 400 s vs ours 3 600 s (Partial).
- Revocation ≈ wallet suspend (Partial); mandate-level revoke absent.
- Expiry / currency / allowed_payees / payee checks — not modeled
  (NOT_MAPPABLE 15 vectors total).

## GATE_EXCEPTION

- V21
- L24
— registry failure path throws → fail-closed 500, no deny evidence.

## Own-invariant findings (probes, not MMF)

- **OWN-1** (high) — check-then-insert TOCTOU: parallel begins overshoot caps
- **OWN-2** (high) — corrupted-JSON ledger fails OPEN and clobbers history
- **OWN-3** (medium) — not-registered + registry-throw deny without evidence
- **OWN-4** (medium) — refId is never a dedup key — retries double-charge caps

- race: db-barrier 8/8 reserved (+$60 overshoot);
  memory 32/32 (+$220).

*All findings triaged in docs/EPICS/255-mmf-conformance/
EPIC-234-CANDIDATES.md. Machine-readable: report.json.*
