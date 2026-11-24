# agentbadge/scan-action

CI-gate for Agent Surface Intelligence: runs a scan, diffs against
the previous signed canonical report, emits SARIF and an exit code.

> Source of truth lives in `spreadzp/agentbadge` under
> `actions/scan-action/` and is published to the public
> `agentbadge/scan-action` repo (`v1` tag) at release time.

## Usage

```yaml
- uses: agentbadge/scan-action@v1
  with:
    site_key: ${{ secrets.AGENTBADGE_SITE_KEY }}
    fail_on: new_finding   # new_finding | score_drop | none
    min_score: 60          # optional readiness floor

- uses: github/codeql-action/upload-sarif@v3
  if: always()
  with:
    sarif_file: ${{ steps.intel.outputs.sarif_file }}
```

## Gate semantics (server-derived, signed)

- `new finding` → exit 1 (fail_on=new_finding)
- readiness/exposure delta < 0 → exit 1 (fail_on=score_drop)
- head readiness < min_score → exit 1
- `fail_on: none` → always exit 0
- `bootstrap` (first report) → exit 0, baseline note
- `chain_broken` (history tamper/prune) → exit 0 + warning annotation
- `ruleset_compatible: false` → exit 0 (scores not comparable —
  never a fake-zero, never a silent pass)
- scan cooldown (429) → diff still runs on stored reports + notice

All diff semantics are computed and signed on the backend
(`GET /api/intel/report-diff`); this action holds no policy.
