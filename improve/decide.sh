#!/usr/bin/env bash
set -euo pipefail

# improve/decide.sh — Decide stage: review proposal cards one at a time,
# accept or skip each, then optionally run apply.sh on the accepted ones.
#
# This is the deliberately-human stage of the loop. Interactive by design.

usage() {
    cat <<'USAGE'
Usage: improve/decide.sh [options]

Options:
  --gen DIR          Generation directory (default: latest improve/generations/gen-*)
  --apply-model M    Model for apply.sh runs (default: apply.sh default)
  --no-apply         Review and sort cards only; skip the apply step
  -h, --help         Show this help
USAGE
    exit "${1:-0}"
}

die() { printf 'decide: error: %s\n' "$*" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMPROVE_DIR="$REPO_ROOT/improve"

GEN_DIR=""
APPLY_MODEL=""
NO_APPLY=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --gen)         GEN_DIR="${2:?--gen requires a directory}"; shift 2 ;;
        --apply-model) APPLY_MODEL="${2:?--apply-model requires a value}"; shift 2 ;;
        --no-apply)    NO_APPLY=1; shift ;;
        -h|--help)     usage ;;
        *)             die "unknown option: $1" ;;
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
                mv "$card" "$GEN_DIR/accepted/"
                accepted+=("$GEN_DIR/accepted/$(basename "$card")")
                printf '  → accepted\n'
                break ;;
            s|S) printf '  → skipped (stays in proposals/)\n'; break ;;
            q|Q) printf '  → quitting review\n'; break 2 ;;
            *)   printf '  (a, s, or q)\n' ;;
        esac
    done
done

printf '\n════════ decision summary ════════\n'
printf 'Accepted: %d of %d card(s)\n' "${#accepted[@]}" "$total"
[[ ${#accepted[@]} -gt 0 ]] || exit 0

if [[ "$NO_APPLY" -eq 1 ]]; then
    printf 'Apply later with:\n'
    for card in "${accepted[@]}"; do
        printf '  improve/apply.sh %s\n' "$card"
    done
    exit 0
fi

apply_args=()
if [[ -n "$APPLY_MODEL" ]]; then apply_args+=(--model "$APPLY_MODEL"); fi

for card in "${accepted[@]}"; do
    printf '\nApply %s now? [y/N] > ' "$(basename "$card")"
    read -r ans < /dev/tty
    case "$ans" in
        y|Y)
            "$IMPROVE_DIR/apply.sh" "$card" "${apply_args[@]+"${apply_args[@]}"}" \
                || printf 'decide: apply failed for %s — fix or revert before continuing\n' "$(basename "$card")" >&2
            ;;
        *) printf '  → deferred (apply later: improve/apply.sh %s)\n' "$card" ;;
    esac
done

printf '\nDone. Review the working tree with: git diff\n'
printf 'Commit manually when satisfied, then start the next generation:\n'
printf '  improve/cycle.sh --new-gen\n'
