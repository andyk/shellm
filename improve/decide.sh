#!/usr/bin/env bash
set -euo pipefail

# improve/decide.sh — Decide stage: review proposal cards one at a time,
# accept or skip each, then hand the accepted ones off to Claude Code via
# handoff.sh (which prints the bootstrap command to run).
#
# This is the deliberately-human stage of the loop. Interactive by design.

usage() {
    cat <<'USAGE'
Usage: improve/decide.sh [options]

Options:
  --gen DIR          Generation directory (default: latest improve/generations/gen-*)
  --no-handoff       Review and sort cards only; skip generating the handoff prompt
  -h, --help         Show this help
USAGE
    exit "${1:-0}"
}

die() { printf 'decide: error: %s\n' "$*" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMPROVE_DIR="$REPO_ROOT/improve"

GEN_DIR=""
NO_HANDOFF=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --gen)        GEN_DIR="${2:?--gen requires a directory}"; shift 2 ;;
        --no-handoff) NO_HANDOFF=1; shift ;;
        -h|--help)    usage ;;
        *)            die "unknown option: $1" ;;
    esac
done

if [[ -z "$GEN_DIR" ]]; then
    GEN_DIR=$(ls -1d "$IMPROVE_DIR/generations"/gen-*/ 2>/dev/null | sort | tail -1)
    [[ -n "$GEN_DIR" ]] || die "no generations found"
    GEN_DIR="${GEN_DIR%/}"
fi
[[ -d "$GEN_DIR/proposals" ]] || die "no proposals in $GEN_DIR — run improve/synthesize.sh (or cycle.sh) first"

[[ -r /dev/tty ]] || die "decide.sh is interactive — run it from a terminal"

shopt -s nullglob
cards=()
for c in "$GEN_DIR/proposals"/*.md; do
    [[ "$(basename "$c")" == _* ]] && continue
    cards+=("$c")
done
shopt -u nullglob
[[ ${#cards[@]} -gt 0 ]] || die "no proposal cards in $GEN_DIR/proposals (already decided?)"

mkdir -p "$GEN_DIR/accepted"

GEN_NAME=$(basename "$GEN_DIR")
LEDGER="$IMPROVE_DIR/decisions.md"

# Append a decision line to the committed ledger (anti-whiplash memory).
record_decision() {
    local verdict="$1" card="$2" note="$3"
    local slug target
    slug=$(basename "$card" .md)
    target=$(grep -m1 '^\*\*Target component:\*\*' "$card" | sed 's/^\*\*Target component:\*\* *//') || true
    printf -- '- %s %s %s %s → %s — %s\n' \
        "$(date +%Y-%m-%d)" "$GEN_NAME" "$verdict" "$slug" "${target:-unknown}" "$note" >> "$LEDGER"
}

accepted=()
total=${#cards[@]}
n=0
for card in "${cards[@]}"; do
    n=$(( n + 1 ))
    printf '\n────────────────────────────────────────────────────────────\n'
    printf ' Card %d/%d: %s\n' "$n" "$total" "$(basename "$card")"
    printf '────────────────────────────────────────────────────────────\n\n'
    cat "$card"
    printf '\n'
    while true; do
        printf '[a]ccept  [s]kip  [q]uit review > '
        read -r ans < /dev/tty
        case "$ans" in
            a|A)
                record_decision ACCEPTED "$card" "pending implementation"
                mv "$card" "$GEN_DIR/accepted/"
                accepted+=("$GEN_DIR/accepted/$(basename "$card")")
                printf '  → accepted\n'
                break ;;
            s|S)
                printf '  optional one-line reason (enter to skip): '
                read -r why < /dev/tty
                record_decision SKIPPED "$card" "${why:-no reason given}"
                printf '  → skipped (stays in proposals/)\n'
                break ;;
            q|Q) printf '  → quitting review\n'; break 2 ;;
            *)   printf '  (a, s, or q)\n' ;;
        esac
    done
done

printf '\n════════ decision summary ════════\n'
printf 'Accepted: %d of %d card(s)\n' "${#accepted[@]}" "$total"
[[ ${#accepted[@]} -gt 0 ]] || exit 0

if [[ "$NO_HANDOFF" -eq 1 ]]; then
    printf 'Generate the implementation handoff later with:\n'
    printf '  improve/handoff.sh --gen %s\n' "$GEN_DIR"
    exit 0
fi

# Bundle everything currently in accepted/ (including cards accepted in
# earlier decide runs) into the Claude Code handoff prompt.
printf '\n'
"$IMPROVE_DIR/handoff.sh" --gen "$GEN_DIR" >/dev/null

printf 'After Claude Code finishes: review with `git diff`, commit manually,\n' >&2
printf 'paste its per-card report into improve/log.md, then:\n' >&2
printf '  improve/cycle.sh --new-gen\n' >&2
