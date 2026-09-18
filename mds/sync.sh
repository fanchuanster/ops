#!/usr/bin/env bash
set -euo pipefail

MDS="$(cd "$(dirname "$0")" && pwd)"
WS_ROOT="${WS_ROOT:-$(cd "$MDS/../.." && pwd)}"
BANNER='<!-- Generated from CLAUDE.md by mds/sync.sh. Edit the CLAUDE.md in the mds repo, not this file. -->'
SKILL_BANNER='<!-- Generated from skills/<name>/SKILL.md by mds/sync.sh. Edit it in the mds repo, not this file. -->'
MAX_DEPTH=5
ARGUMENTS_PLACEHOLDER="<the user's request>"
COMMAND_DROPS=' name '
SKILL_DROPS=' argument-hint '

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

emit_skill() {
    local source="$1" drops="$2" substitute="$3" target="$4"
    mkdir -p "$(dirname "$target")"
    awk -v drops="$drops" -v banner="$SKILL_BANNER" -v substitute="$substitute" '
        BEGIN { fence = 0; keeping = 1 }
        /^---[[:space:]]*$/ && fence < 2 {
            fence++
            print "---"
            if (fence == 2) printf "\n%s\n\n", banner
            next
        }
        fence == 1 {
            if (match($0, /^[A-Za-z0-9_-]+:/))
                keeping = index(drops, " " substr($0, 1, RLENGTH - 1) " ") == 0
            if (keeping) print
            next
        }
        fence == 2 {
            if (started == 0 && $0 ~ /^[[:space:]]*$/) next
            started = 1
            if (substitute != "") gsub(/\$ARGUMENTS/, substitute)
            print
        }
    ' "$source" > "$target"
}

sync_skills() {
    local repo="$1" dest="$2" source name count=0
    [ -d "$repo/skills" ] || return 0

    while IFS= read -r source; do
        name="$(basename "$(dirname "$source")")"

        emit_skill "$source" "$COMMAND_DROPS" "" "$dest/.claude/commands/$name.md"

        rm -rf "${dest:?}/.github/skills/$name"
        mkdir -p "$dest/.github/skills/$name"
        cp -RL "$(dirname "$source")/." "$dest/.github/skills/$name/"
        emit_skill "$source" "$SKILL_DROPS" "$ARGUMENTS_PLACEHOLDER" "$dest/.github/skills/$name/SKILL.md"

        count=$((count + 1))
    done < <(find "$repo/skills" -mindepth 2 -maxdepth 2 -name SKILL.md | sort)

    [ "$count" -eq 0 ] || echo "synced $repo -> $count skill(s) as .claude/commands/ and .github/skills/"
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
    sync_skills "$repo" "$dest"
done < <(find . -name 'CLAUDE.md' -printf '%P\n' | sort)
