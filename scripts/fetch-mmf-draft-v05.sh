#!/usr/bin/env bash
# fetch-mmf-draft-v05.sh — vendor the Mandata MMF v0.5-clamp DRAFT corpus
# into tests/conformance/mmf/draft-v05-clamp/, pinned to a commit SHA.
#
# Pin policy (EPIC-263, D-263-Q6): SHA pin, NEVER branch-head — the draft
# was frozen at a91b7f4 (DM 2026-11-23 15:28). Re-pin only on a new
# freeze notice from the thread.
#
# Usage:
#   scripts/fetch-mmf-draft-v05.sh [commit-sha]   # default: a91b7f4
#
# Effects:
#   1. fetches the 3 draft files via gh api at the pinned sha
#   2. rewrites MANIFEST.json (commit_sha, fetched_at, per-file sha256)
#   3. prints git-style diff so the update is reviewable
set -euo pipefail

SHA="${1:-a91b7f4}"
REPO="ashedrack/mandata"
DEST="tests/conformance/mmf/draft-v05-clamp"

# Run from repo root (hackathon/server) regardless of caller cwd.
cd "$(dirname "$0")/.."

mkdir -p "$DEST"

declare -A MAP=(
  ["mmf-v0.5-clamp-proposal.md"]="spec/drafts/mmf-v0.5-clamp-proposal.md"
  ["clamp-core.json"]="spec/drafts/vectors/clamp-core.json"
  ["clamp-delegation.json"]="spec/drafts/vectors/clamp-delegation.json"
)

echo ">> fetching $REPO @ $SHA"
for dst in "${!MAP[@]}"; do
  src="${MAP[$dst]}"
  gh api "repos/$REPO/contents/$src?ref=$SHA" --jq '.content' | base64 -d > "$DEST/$dst"
  echo "   $src -> $DEST/$dst"
done

FETCHED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
cd "$DEST"
python3 - "$SHA" "$FETCHED_AT" <<'PY'
import hashlib, json, sys
sha, at = sys.argv[1], sys.argv[2]
names = ["mmf-v0.5-clamp-proposal.md", "clamp-core.json", "clamp-delegation.json"]
files = {n: hashlib.sha256(open(n, "rb").read()).hexdigest() for n in names}
manifest = {
    "upstream": "ashedrack/mandata",
    "branch": "draft/v0.5-clamp",
    "commit_sha": sha,
    "fetched_at": at,
    "draft_version": "mmf-v0.5-draft",
    "note": "FROZEN pin (DM 2026-11-23 15:28 — 7/7 §11 choices resolved). Re-pin only on a new freeze via scripts/fetch-mmf-draft-v05.sh.",
    "files": files,
    "upstream_paths": {
        "mmf-v0.5-clamp-proposal.md": "spec/drafts/mmf-v0.5-clamp-proposal.md",
        "clamp-core.json": "spec/drafts/vectors/clamp-core.json",
        "clamp-delegation.json": "spec/drafts/vectors/clamp-delegation.json",
    },
    "generated": {
        "golden-evidence-clamped.json": "produced by OUR mmf-canon §6 implementation (offer accepted DM 15:28 — hash must come from an implementation, not be written by hand)"
    },
}
open("MANIFEST.json", "w").write(json.dumps(manifest, indent=2) + "\n")
for n, h in files.items():
    print(f"{h}  {n}")
PY

cd - >/dev/null
git diff --stat -- "$DEST" || true
git status --short -- "$DEST"
