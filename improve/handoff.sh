#!/usr/bin/env bash
set -euo pipefail

# improve/handoff.sh — Apply stage, Claude Code edition: bundle accepted
# proposal cards into an implementation prompt and print the command that
# bootstraps a Claude Code session to (1) independently verify each card
# against the codebase and (2) implement the ones that survive scrutiny.
#
# The agent does not modify its own code in this path; a separate coding
# agent with fresh eyes does, and the human still reviews and commits.

usage() {
    cat <<'USAGE'
Usage: improve/handoff.sh [options] [card.md ...]

Bundles proposal cards (default: all in <gen>/accepted/) into
<gen>/accepted/PROMPT.md and prints the claude command to run it.

Options:
  --gen DIR      Generation directory (default: latest improve/generations/gen-*)
  -h, --help     Show this help
USAGE
    exit "${1:-0}"
}

die() { printf 'handoff: error: %s\n' "$*" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMPROVE_DIR="$REPO_ROOT/improve"

GEN_DIR=""
CARDS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --gen)     GEN_DIR="${2:?--gen requires a directory}"; shift 2 ;;
        -h|--help) usage ;;
        -*)        die "unknown option: $1" ;;
        *)         CARDS+=("$1"); shift ;;
    esac
done

if [[ -z "$GEN_DIR" ]]; then
    GEN_DIR=$(ls -1d "$IMPROVE_DIR/generations"/gen-*/ 2>/dev/null | sort | tail -1)
    [[ -n "$GEN_DIR" ]] || die "no generations found"
    GEN_DIR="${GEN_DIR%/}"
fi

if [[ ${#CARDS[@]} -eq 0 ]]; then
    shopt -s nullglob
    for c in "$GEN_DIR/accepted"/*.md; do
        [[ "$(basename "$c")" == "PROMPT.md" ]] && continue
        CARDS+=("$c")
    done
    shopt -u nullglob
fi
[[ ${#CARDS[@]} -gt 0 ]] || die "no accepted cards found in $GEN_DIR/accepted"
for c in "${CARDS[@]}"; do
    [[ -f "$c" ]] || die "card not found: $c"
done

PROMPT_FILE="$GEN_DIR/accepted/PROMPT.md"
mkdir -p "$GEN_DIR/accepted"

{
    cat <<PREAMBLE
You are implementing accepted change proposals for the shellm repo at $REPO_ROOT. The proposals below were produced by shellm's self-improvement loop: an LLM critiqued trajectories of the agent's autonomous sessions and synthesized these cards. They have been human-selected, but NOT independently verified against the codebase — that is your first job.

## Step 1 — Verify each card before touching anything

The cards were written from session trajectories, not from reading the code. For each card, read the target component and enough surrounding code to independently confirm:
- The diagnosed problem actually exists in the code as described.
- The proposed change is the right fix at the right layer (prefer the smallest change; prefer a prompt edit over a script change, a script change over a harness change).
- The change won't break behaviors the card's "Regression risk" section — or your own reading — says to preserve.

Supporting evidence lives in this generation's artifacts (session trajectories, thinker logs, critiques):
- $GEN_DIR/critiques/
- $GEN_DIR/identities/<run>/trajectories/ and .../run/logs/

Give each card a verdict: IMPLEMENT (as proposed), REVISE (implement the intent, different mechanics — explain), or REJECT (diagnosis wrong or change unsafe — explain, change nothing).

## Step 2 — Implement the survivors

- One card at a time; keep each card's diff minimal and in the style of the surrounding code.
- Never touch improve/ or tests/ unless a card explicitly targets them (none should — reject any that do). Exception: the decision ledger update in Step 4.
- Check $REPO_ROOT/improve/decisions.md before implementing: if a card duplicates or contradicts an earlier IMPLEMENTED/REVISED entry, prefer REJECT (duplicate) or a tuning REVISE over reverting prior work.
- Do NOT run any git write commands (no add/commit/branch/checkout). The human reviews the diff and commits.

## Step 3 — Gates

After implementing, for every file you changed: run \`bash -n\` on shell scripts, \`shellcheck -S warning\` if shellcheck is installed, and \`tests/test_context.sh\` if you touched bin/context.

## Step 4 — Record and report

Update the decision ledger at $REPO_ROOT/improve/decisions.md: each card below already has an entry ending in "pending implementation" — replace that suffix with your verdict, formatted as \`IMPLEMENTED: <one-line summary>\`, \`REVISED: <what you did instead and why>\`, or \`REJECTED: <why the card was wrong>\`. (This ledger is the only improve/ file you may edit; it is what keeps future generations from re-proposing or reverting this work.)

Then finish with a per-card summary: verdict, files changed, gate results, and anything you noticed that the next loop generation should know (this gets pasted into improve/log.md).

---

PREAMBLE

    n=0
    for c in "${CARDS[@]}"; do
        n=$(( n + 1 ))
        printf '## Card %d of %d — %s\n\n' "$n" "${#CARDS[@]}" "$(basename "$c")"
        cat "$c"
        printf '\n---\n\n'
    done
} > "$PROMPT_FILE"

printf 'handoff: %d card(s) bundled into %s\n\n' "${#CARDS[@]}" "$PROMPT_FILE" >&2
printf 'Bootstrap the implementation with:\n\n' >&2
printf '  cd %s && claude "$(cat %s)"\n\n' "$REPO_ROOT" "$PROMPT_FILE" >&2
printf 'Then review with `git diff` and commit manually.\n' >&2

# stdout contract: the prompt file path
printf '%s\n' "$PROMPT_FILE"
