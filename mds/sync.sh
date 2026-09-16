#!/usr/bin/env bash
set -euo pipefail

MDS="$(cd "$(dirname "$0")" && pwd)"
WS_ROOT="${WS_ROOT:-$(cd "$MDS/../.." && pwd)}"
BANNER='<!-- Generated from CLAUDE.md by mds/sync.sh. Edit the CLAUDE.md in the mds repo, not this file. -->'
MAX_DEPTH=5

import_re='s/^@\(\.\/\)\?\([A-Za-z0-9._-][A-Za-z0-9._/-]*\)[[:space:]]*$/\2/p'

imports_of() {
    sed -n "$import_re" "$1"
}

import_paths() {
    local file="$1" depth="${2:-0}" dir child path
    if [ "$depth" -gt "$MAX_DEPTH" ]; then
        echo "import depth exceeded at $file" >&2
        return 1
    fi
    dir="$(dirname "$file")"
    while IFS= read -r child; do
        path="${dir}/${child}"
        path="${path#./}"
        if [ ! -f "$path" ]; then
            echo "missing $path (imported by $file)" >&2
            return 1
        fi
        printf '%s\n' "$path"
        import_paths "$path" $((depth + 1))
    done < <(imports_of "$file")
}

flatten() {
    local file="$1" depth="${2:-0}" dir line child
    if [ "$depth" -gt "$MAX_DEPTH" ]; then
        echo "import depth exceeded at $file" >&2
        return 1
    fi
    dir="$(dirname "$file")"
    while IFS= read -r line || [ -n "$line" ]; do
        child="$(printf '%s\n' "$line" | sed -n "$import_re")"
        if [ -z "$child" ]; then
            printf '%s\n' "$line"
            continue
        fi
        flatten "${dir}/${child}" $((depth + 1))
        printf '\n'
    done < "$file"
}

cd "$MDS"
while IFS= read -r rel; do
    repo="$(dirname "$rel")"
    dest="$WS_ROOT/$repo"

    if [ ! -d "$dest" ]; then
        echo "skip $repo (no checkout at $dest)" >&2
        continue
    fi

    if ! parts="$(import_paths "$rel")"; then
        echo "aborting $repo: unresolvable imports in $rel" >&2
        exit 1
    fi

    install -Dm644 "$rel" "$dest/CLAUDE.md"
    copied="CLAUDE.md"

    while IFS= read -r part; do
        [ -n "$part" ] || continue
        install -Dm644 "$part" "$dest/${part#"$repo/"}"
        copied="$copied, ${part#"$repo/"}"
    done <<< "$parts"

    mkdir -p "$dest/.github"
    { printf '%s\n\n' "$BANNER"; flatten "$rel"; } > "$dest/.github/copilot-instructions.md"
    echo "synced $repo -> $copied, .github/copilot-instructions.md"
done < <(find . -name 'CLAUDE.md' -printf '%P\n' | sort)
