#!/usr/bin/env bash
set -euo pipefail

# improve/apply.sh — Apply stage: implement one accepted proposal card.
#
# v0: NO git automation. The card is implemented by a shellm run editing the
# working tree (the agent modifies itself); you review with `git diff` and
# commit manually. Gates: bash -n + shellcheck on modified scripts, and
# tests/test_context.sh if bin/context was touched.

usage() {
    cat <<'USAGE'
Usage: improve/apply.sh <proposal-card.md> [options]

Options:
  --model MODEL  Implementer model (default: $IMPROVE_MODEL, $SHELLM_MODEL, or claude-opus-4-7)
  --manual       Don't run the agent; just print the card and gate checklist
  -h, --help     Show this help
USAGE
    exit "${1:-0}"
}

die() { printf 'apply: error: %s\n' "$*" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$REPO_ROOT/bin:$PATH"
# shellcheck disable=SC1091
if [[ -f "$REPO_ROOT/.env" ]]; then set -a; source "$REPO_ROOT/.env"; set +a; fi

CARD=""
MODEL="${IMPROVE_MODEL:-${SHELLM_MODEL:-claude-opus-4-7}}"
MANUAL=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --model)   MODEL="${2:?--model requires a value}"; shift 2 ;;
        --manual)  MANUAL=1; shift ;;
        -h|--help) usage ;;
        -*)        die "unknown option: $1" ;;
        *)         [[ -n "$CARD" ]] && die "unexpected argument: $1"; CARD="$1"; shift ;;
    esac
done

[[ -n "$CARD" ]] || usage 1
[[ -f "$CARD" ]] || die "proposal card not found: $CARD"

# Refuse to let the loop mutate itself in v0.
if grep -qE '^\*\*Target component:\*\*.*improve/' "$CARD"; then
    die "card targets improve/ — the loop may not modify itself in v0"
fi

before_status=$(cd "$REPO_ROOT" && git status --porcelain)

if [[ "$MANUAL" -eq 1 ]]; then
    printf '▶ Manual mode. Implement this card, then re-run gates below.\n\n' >&2
    cat "$CARD"
else
    printf '▶ Implementing card with %s: %s\n' "$MODEL" "$(basename "$CARD")" >&2
    instructions="You are implementing one accepted change proposal for the shellm repo, as part of its self-improvement loop. The repo working tree is your workdir: $REPO_ROOT

Rules:
- Edit ONLY what the card's Target component calls for (plus tightly-coupled files the card itself names).
- Never touch anything under improve/ or tests/, and do not run any git write commands (no add/commit/branch) — a human reviews the diff and commits.
- Keep the diff minimal and in the style of the surrounding code.
- When done, set FINAL to a short summary listing each file you changed and why.

The proposal card:

$(cat "$CARD")"
    SHELLM_MODEL="$MODEL" shellm --workdir "$REPO_ROOT" "$instructions" \
        || die "shellm implementation run failed"
fi

# --- Gates -------------------------------------------------------------------
after_status=$(cd "$REPO_ROOT" && git status --porcelain)
changed=$(comm -13 <(printf '%s\n' "$before_status" | sort) <(printf '%s\n' "$after_status" | sort) \
    | awk '{ print $2 }')

if [[ -z "$changed" && "$MANUAL" -eq 0 ]]; then
    printf '▶ Warning: no files changed — the run may not have implemented anything.\n' >&2
    exit 1
fi

fail=0
while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    path="$REPO_ROOT/$f"
    [[ -f "$path" ]] || continue
    if head -1 "$path" 2>/dev/null | grep -q 'bash' || [[ "$f" == *.sh ]]; then
        printf '▶ Gate: bash -n %s\n' "$f" >&2
        bash -n "$path" || { printf '  FAILED syntax check\n' >&2; fail=1; }
        if command -v shellcheck >/dev/null 2>&1; then
            printf '▶ Gate: shellcheck %s\n' "$f" >&2
            shellcheck -S warning "$path" || { printf '  shellcheck warnings above\n' >&2; }
        fi
    fi
    if [[ "$f" == "bin/context" ]]; then
        printf '▶ Gate: tests/test_context.sh\n' >&2
        (cd "$REPO_ROOT" && tests/test_context.sh) || { printf '  FAILED context tests\n' >&2; fail=1; }
    fi
done <<< "$changed"

printf '\n▶ Changed files:\n%s\n' "${changed:-  (none)}" >&2
if [[ "$fail" -ne 0 ]]; then
    printf '▶ GATES FAILED — fix or revert before committing.\n' >&2
    exit 1
fi
printf '▶ Gates passed. Review with: git diff\n' >&2
printf '▶ Commit manually when satisfied (no git automation in v0).\n' >&2
