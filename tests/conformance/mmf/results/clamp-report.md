# MMF v0.5-clamp DRAFT — conformance run (EPIC-263)

Corpus: Mandata MMF **mmf-v0.5-draft** — pin commit
`a91b7f4` (branch draft/v0.5-clamp, FROZEN), fetched
2026-11-26T13:20:07Z. sha256 per file in MANIFEST.json + results
corpus_sha256 fields.

Third implementation overall, first written against the spec rather
than alongside it. Same discipline as the v0.4.24 run: *we test the
implementation we actually have* — nothing was emulated to conform.

## Metrics (separate per decision)

| Metric | n | Status | Equivalence |
|---|---|---|---|
| clamp-core (K) | 16 | PASS 8 · NOT_MAPPABLE 8 | None 16 |
| clamp-delegation (KD) | 5 | PASS 4 · NOT_MAPPABLE 1 | None 5 |

## NOT_MAPPABLE (mechanism absent — honest non-coverage)

- **K06** — check PAYEE has no prod mechanism
- **K07** — check CURRENCY has no prod mechanism
- **K09** — check EXPIRED has no prod mechanism
- **K12** — draft total_budget carries no budget_window_days — unwindowed budget has no prod mechanism
- **K13** — draft total_budget carries no budget_window_days — unwindowed budget has no prod mechanism
- **K14** — stored-decision replay — no decision-store in prod (tx_id is correlation-only)
- **K15** — check TX_CONFLICT has no prod mechanism
- **K16** — claim binds the effective amount: claiming the requested amount fails as CLAIM:BINDING, claiming the effective amount succeeds
- **KD05** — clamped spends are charged to every ancestor: the parent's budget stops the child

## Notes

- Shape 2: allowed+clamped decisions carry check=CAP_EXCEEDED (the
  bound that adjusted the amount); WITHIN stays for unadjusted allows.
- K11 velocity counts the clamped authorization as one issued auth —
  passes via maxTxPerHour (Partial window equivalence).
- Golden evidence-hash vectors for §6 produced by our canonicalizer:
  draft-v05-clamp/golden-evidence-clamped.json (E-series format, KE01–03).
- Old corpus results untouched: this run writes results/clamp.json
  only (separate file, separate corpus_version).

*Machine-readable: results/clamp.json.*
