#!/usr/bin/env bash
set -euo pipefail

# improve/synthesize.sh — Synthesize stage: critiques → ranked proposal cards.
#
# Feeds all of a generation's critiques + vitals + a component map to an LLM
# (via prompts/synthesizer.md) and splits the output into one card per file
# under <gen>/proposals/. The human then moves chosen cards to <gen>/accepted/.

usage() {
    cat <<'USAGE'
Usage: improve/synthesize.sh [options]

Options:
  --gen DIR      Generation directory (default: latest improve/generations/gen-*)
  --model MODEL  Synthesizer model (default: $IMPROVE_MODEL, $SHELLM_MODEL, or claude-opus-4-7)
  -h, --help     Show this help
USAGE
    exit "${1:-0}"
}

die() { printf 'synthesize: error: %s\n' "$*" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMPROVE_DIR="$REPO_ROOT/improve"
export PATH="$REPO_ROOT/bin:$PATH"
# shellcheck disable=SC1091
if [[ -f "$REPO_ROOT/.env" ]]; then set -a; source "$REPO_ROOT/.env"; set +a; fi

GEN_DIR=""
MODEL="${IMPROVE_MODEL:-${SHELLM_MODEL:-claude-opus-4-7}}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --gen)     GEN_DIR="${2:?--gen requires a directory}"; shift 2 ;;
        --model)   MODEL="${2:?--model requires a value}"; shift 2 ;;
        -h|--help) usage ;;
        *)         die "unknown option: $1" ;;
    esac
done

if [[ -z "$GEN_DIR" ]]; then
    GEN_DIR=$(ls -1d "$IMPROVE_DIR/generations"/gen-*/ 2>/dev/null | sort | tail -1)
    [[ -n "$GEN_DIR" ]] || die "no generations found; run improve/session.sh first"
    GEN_DIR="${GEN_DIR%/}"
fi
[[ -d "$GEN_DIR" ]] || die "generation dir not found: $GEN_DIR"

shopt -s nullglob
critiques=("$GEN_DIR/critiques"/*.md)
shopt -u nullglob
[[ ${#critiques[@]} -gt 0 ]] || die "no critiques in $GEN_DIR/critiques — run improve/critique.sh first"

PROPOSALS_DIR="$GEN_DIR/proposals"
mkdir -p "$PROPOSALS_DIR" "$GEN_DIR/accepted"

# --- Assemble input ---------------------------------------------------------
materials() {
    printf '# Component map of the organism (repo root: %s)\n\n' "$REPO_ROOT"
    printf 'Harness tools (single-file bash):\n```\n'
    ls -1 "$REPO_ROOT/bin"
    printf '```\n\nThinkers (each: prompt.md, step, subscriptions.jsonl):\n```\n'
    ls -1 "$REPO_ROOT/thinkers" | grep -v '^_' || true
    printf '```\n\nBundled skills (skills/<name>/SKILL.md):\n```\n'
    ls -1 "$REPO_ROOT/skills" 2>/dev/null || true
    printf '```\n\nAlso mutable: bin/identity _seed_thoughts() (newborn seed thoughts).\n\n'

    if [[ -f "$IMPROVE_DIR/decisions.md" ]]; then
        printf '# Decision ledger (what prior generations proposed, and what became of it)\n\n'
        printf 'Recent entries, oldest first:\n\n```\n'
        awk '/^## Entries/{found=1; next} found' "$IMPROVE_DIR/decisions.md" | tail -40
        printf '```\n\n'
        printf 'Recent repo commits (fixes may have landed under these):\n\n```\n'
        (cd "$REPO_ROOT" && git log --oneline -15 2>/dev/null) || true
        printf '```\n\n'
    fi

    if [[ -f "$GEN_DIR/vitals.csv" ]]; then
        printf '# Vitals for this generation\n\n```csv\n'
        cat "$GEN_DIR/vitals.csv"
        printf '```\n\n'
    fi
    if [[ -f "$GEN_DIR/sessions.csv" ]]; then
        printf '# Sessions\n\n```csv\n'
        cat "$GEN_DIR/sessions.csv"
        printf '```\n\n'
    fi

    printf '# Critiques (%d sessions)\n\n' "${#critiques[@]}"
    local c
    for c in "${critiques[@]}"; do
        printf -- '--- critique: %s ---\n\n%s\n\n' "$(basename "$c")" "$(cat "$c")"
    done
}

printf '▶ Synthesizing %d critiques (%s) with %s\n' "${#critiques[@]}" "$(basename "$GEN_DIR")" "$MODEL" >&2
raw="$PROPOSALS_DIR/_raw.md"
materials | llm -m "$MODEL" -t 8192 -s "$(cat "$IMPROVE_DIR/prompts/synthesizer.md")" > "$raw" \
    || die "llm call failed"

# --- Split into one file per card -------------------------------------------
count=$(awk -v dir="$PROPOSALS_DIR" '
    /^=== PROPOSAL: .+ ===[[:space:]]*$/ {
        if (out) close(out)
        n += 1
        slug = $0
        sub(/^=== PROPOSAL: /, "", slug)
        sub(/ ===[[:space:]]*$/, "", slug)
        gsub(/[^a-zA-Z0-9-]/, "-", slug)
        out = sprintf("%s/%02d-%s.md", dir, n, slug)
        next
    }
    out { print > out }
    END { print n + 0 }
' "$raw")

if [[ "$count" -eq 0 ]]; then
    printf '▶ Warning: no "=== PROPOSAL: ===" markers found; see raw output: %s\n' "$raw" >&2
    exit 1
fi

printf '▶ %s proposal card(s):\n' "$count" >&2
ls -1 "$PROPOSALS_DIR" | grep -v '^_' >&2
printf '\nReview and accept/skip them interactively (records to the decision ledger):\n' >&2
printf '  improve/decide.sh\n' >&2
