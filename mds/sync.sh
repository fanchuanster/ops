#!/usr/bin/env bash
set -euo pipefail

MDS="$(cd "$(dirname "$0")" && pwd)"
WS_ROOT="${WS_ROOT:-$(cd "$MDS/../.." && pwd)}"
BANNER='<!-- Generated from CLAUDE.md by mds/sync.sh. Edit the CLAUDE.md in the mds repo, not this file. -->'

cd "$MDS"
find . -name CLAUDE.md -printf '%P\n' | sort | while read -r rel; do
    repo="$(dirname "$rel")"
    dest="$WS_ROOT/$repo"

    if [ ! -d "$dest" ]; then
        echo "skip $repo (no checkout at $dest)" >&2
        continue
    fi

    install -Dm644 "$rel" "$dest/CLAUDE.md"
    mkdir -p "$dest/.github"
    { printf '%s\n\n' "$BANNER"; cat "$rel"; } > "$dest/.github/copilot-instructions.md"
    echo "synced $repo -> CLAUDE.md, .github/copilot-instructions.md"
done
