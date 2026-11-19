# MMF Conformance Corpus — vendored

Upstream: [`ashedrack/mandata`](https://github.com/ashedrack/mandata)
`spec/vectors/`, pinned to **git tag `v0.4.24`** (NOT main — D-255-Q27,
Shedrack DM 2026-11-18 18:44: reproducible corpus, deltas attributable
to a fixed corpus version).

- **Spec / corpus version:** v0.4.24 (tag)
- **Pinned commit:** `9aba772200f91a216fb9a8cf5cc48620d6bbfdb2`
- **Vendored:** 2026-11-19 (EPIC-255)
- **Vectors:** 92 = core 36 + delegation 18 + lifecycle 29 + credential 6 + evidence 3
- **License:** Apache-2.0 (upstream)

Per-file `version` fields inside the JSON are domain spec versions
— they are NOT the corpus release version.

## SHA-256 (sha256sum -c compatible)

```text
0ba4e805424527892f5c9c7e6cfd894669858580daba06bc8d13b989d59284a9  core.json
ee5075b0b5d346b87d6c226ed7c59e84edce0f8869f772f2c4a676484ca74442  credential.json
2218ad5eccc16c72e5b941d568432445090916f855e87a3258fb924d184b5900  delegation.json
84cf420549f041db2dd191cc22006b0b5dfe119fb2fabc042982e49791d03ea7  evidence.json
8ec2ffd774bb625aa53d3b02b7085c9ecb6e786e7367e2be83385b4e0f8ca103  lifecycle.json
```

## Embedded conventions (from Shedrack DM)

- `prior_txns` — seeds ledger state before the checked `tx`.
- `registry.revoked` / `registry.unavailable` — controls mandate
  registry behaviour (`unavailable` ≠ `revoked`, D-255-Q5).
- `tx.amount_json` — raw lexical form of the amount; keep as string,
  never coerce (scalar projection, D-255-Q16).
- `steps` — ordered multi-step model for delegation/lifecycle
  (authorize/claim/settle/void + replay by `tx_id`).
- `then_tx`/`then_expect` — second-phase check in core (e.g. denied
  tx must not consume budget).
- `expect.rejected: true` — malformed input rejected before
  evaluation; no decision, no evidence record.
- `events` — expected evidence event vocabulary per lifecycle vector:
  DECISION / REPLAY / REJECTED / CLAIM / SETTLE / VOID.

## Refresh

Corpus update = reviewable diff. Run:

```bash
scripts/fetch-mmf-vectors.sh [tag]
```

which re-vendors from the given tag, recomputes SHA-256, and rewrites
this file. CI is hermetic — never fetch at test time.
