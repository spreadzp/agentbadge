#!/usr/bin/env bash
# fetch-mmf-vectors.sh — vendor the Mandata MMF conformance corpus into
# tests/conformance/mmf/vectors/, pinned to an upstream git TAG.
#
# Pin policy (D-255-Q27, Shedrack DM 2026-11-18 18:44): tag, NEVER main —
# deltas must be attributable to a fixed corpus version. Default tag is
# the one pinned at EPIC-255 start; pass another tag only deliberately
# (corpus update = reviewable diff).
#
# Usage:
#   scripts/fetch-mmf-vectors.sh [tag]        # default: v0.4.24
#
# Effects:
#   1. clones ashedrack/mandata @ <tag> (depth 1) into a tmpdir
#   2. copies spec/vectors/*.json over tests/conformance/mmf/vectors/
#   3. rewrites tests/conformance/mmf/vectors/CORPUS.md with the new
#      tag/commit SHA and recomputed per-file SHA-256
#   4. prints git-style diff stat so the update is reviewable
set -euo pipefail

TAG="${1:-v0.4.24}"
REPO="https://github.com/ashedrack/mandata"
DEST="tests/conformance/mmf/vectors"

# Run from repo root (hackathon/server) regardless of caller cwd.
cd "$(dirname "$0")/.."

case "$TAG" in
  main|master|HEAD)
    echo "error: refusing to pin corpus to '$TAG' — tag required (D-255-Q27)" >&2
    exit 1
    ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo ">> cloning $REPO @ $TAG"
git clone --quiet --depth 1 --branch "$TAG" "$REPO" "$TMP/mandata"

COMMIT="$(git -C "$TMP/mandata" rev-parse HEAD)"
echo ">> pinned commit: $COMMIT"

shopt -s nullglob
FILES=("$TMP"/mandata/spec/vectors/*.json)
if [ "${#FILES[@]}" -eq 0 ]; then
  echo "error: spec/vectors/*.json not found @ $TAG" >&2
  exit 1
fi

mkdir -p "$DEST"
cp "${FILES[@]}" "$DEST/"

# Recompute manifest (sorted by filename for stable diffs).
SUMS="$(cd "$DEST" && sha256sum *.json | sort -k2)"

COUNT=0
for f in "$DEST"/*.json; do
  n="$(python3 -c "import json,sys; d=json.load(open('$f')); v=d['vectors'] if isinstance(d,dict) else d; print(len(v))")"
  COUNT=$((COUNT + n))
done

cat > "$DEST/CORPUS.md" <<EOF
# MMF Conformance Corpus — vendored

Upstream: [\`ashedrack/mandata\`](https://github.com/ashedrack/mandata)
\`spec/vectors/\`, pinned to **git tag \`$TAG\`** (NOT main — D-255-Q27,
Shedrack DM 2026-11-18 18:44: reproducible corpus, deltas attributable
to a fixed corpus version).

- **Spec / corpus version:** $TAG (tag)
- **Pinned commit:** \`$COMMIT\`
- **Vendored:** $(date +%F) (EPIC-255)
- **Vectors:** $COUNT = core $(python3 -c "import json;print(len(json.load(open('$DEST/core.json'))['vectors']))") + delegation $(python3 -c "import json;print(len(json.load(open('$DEST/delegation.json'))['vectors']))") + lifecycle $(python3 -c "import json;print(len(json.load(open('$DEST/lifecycle.json'))['vectors']))") + credential $(python3 -c "import json;print(len(json.load(open('$DEST/credential.json'))))") + evidence $(python3 -c "import json;print(len(json.load(open('$DEST/evidence.json'))['vectors']))")
- **License:** Apache-2.0 (upstream)

Per-file \`version\` fields inside the JSON are domain spec versions
— they are NOT the corpus release version.

## SHA-256 (sha256sum -c compatible)

\`\`\`text
$SUMS
\`\`\`

## Embedded conventions (from Shedrack DM)

- \`prior_txns\` — seeds ledger state before the checked \`tx\`.
- \`registry.revoked\` / \`registry.unavailable\` — controls mandate
  registry behaviour (\`unavailable\` ≠ \`revoked\`, D-255-Q5).
- \`tx.amount_json\` — raw lexical form of the amount; keep as string,
  never coerce (scalar projection, D-255-Q16).
- \`steps\` — ordered multi-step model for delegation/lifecycle
  (authorize/claim/settle/void + replay by \`tx_id\`).
- \`then_tx\`/\`then_expect\` — second-phase check in core (e.g. denied
  tx must not consume budget).
- \`expect.rejected: true\` — malformed input rejected before
  evaluation; no decision, no evidence record.
- \`events\` — expected evidence event vocabulary per lifecycle vector:
  DECISION / REPLAY / REJECTED / CLAIM / SETTLE / VOID.

## Refresh

Corpus update = reviewable diff. Run:

\`\`\`bash
hackathon/server/scripts/fetch-mmf-vectors.sh [tag]
\`\`\`

which re-vendors from the given tag, recomputes SHA-256, and rewrites
this file. CI is hermetic — never fetch at test time.
EOF

echo ">> vendored $COUNT vectors from ${#FILES[@]} files @ $TAG ($COMMIT)"
git diff --stat -- "$DEST" 2>/dev/null || true
git status --short -- "$DEST" 2>/dev/null || true
