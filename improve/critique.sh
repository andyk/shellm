#!/usr/bin/env bash
set -euo pipefail

# improve/critique.sh — Introspect stage: LLM reads one session's mind log.
#
# Bundles the scenario, trajectory, thinker logs, and vitals into one document
# and asks an LLM (via prompts/critic.md) for an evidence-cited critique.

usage() {
    cat <<'USAGE'
Usage: improve/critique.sh <trajectory.jsonl> [options]

Options:
  --label NAME        Session label (default: inferred from path)
  --identity-dir DIR  Identity dir (default: inferred by walking up from the trajectory)
  --scenario FILE     Scenario file to include (default: inferred from sessions.csv)
  --model MODEL       Critic model (default: $IMPROVE_MODEL, $SHELLM_MODEL, or claude-opus-4-7)
  --out FILE          Output path (default: <gen>/critiques/<label>.md)
  -h, --help          Show this help
USAGE
    exit "${1:-0}"
}

die() { printf 'critique: error: %s\n' "$*" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMPROVE_DIR="$REPO_ROOT/improve"
export PATH="$REPO_ROOT/bin:$PATH"
# shellcheck disable=SC1091
if [[ -f "$REPO_ROOT/.env" ]]; then set -a; source "$REPO_ROOT/.env"; set +a; fi

TRAJ_FILE=""
LABEL=""
IDENTITY_HOME=""
SCENARIO=""
MODEL="${IMPROVE_MODEL:-${SHELLM_MODEL:-claude-opus-4-7}}"
OUT=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --label)        LABEL="${2:?--label requires a value}"; shift 2 ;;
        --identity-dir) IDENTITY_HOME="${2:?--identity-dir requires a directory}"; shift 2 ;;
        --scenario)     SCENARIO="${2:?--scenario requires a file}"; shift 2 ;;
        --model)        MODEL="${2:?--model requires a value}"; shift 2 ;;
        --out)          OUT="${2:?--out requires a path}"; shift 2 ;;
        -h|--help)      usage ;;
        -*)             die "unknown option: $1" ;;
        *)              [[ -n "$TRAJ_FILE" ]] && die "unexpected argument: $1"; TRAJ_FILE="$1"; shift ;;
    esac
done

[[ -n "$TRAJ_FILE" ]] || usage 1
[[ -f "$TRAJ_FILE" ]] || die "trajectory file not found: $TRAJ_FILE"
TRAJ_FILE="$(cd "$(dirname "$TRAJ_FILE")" && pwd)/$(basename "$TRAJ_FILE")"

# Infer the identity dir: walk up looking for info.txt.
if [[ -z "$IDENTITY_HOME" ]]; then
    d="$(dirname "$TRAJ_FILE")"
    for _ in 1 2 3 4; do
        d="$(dirname "$d")"
        if [[ -f "$d/info.txt" ]]; then IDENTITY_HOME="$d"; break; fi
    done
fi

[[ -n "$LABEL" ]] || { [[ -n "$IDENTITY_HOME" ]] && LABEL=$(basename "$IDENTITY_HOME") || LABEL=$(basename "$(dirname "$TRAJ_FILE")"); }

# Infer generation dir (…/generations/gen-NNN) if the trajectory lives in one.
GEN_DIR=""
d="$(dirname "$TRAJ_FILE")"
while [[ "$d" != "/" ]]; do
    case "$(basename "$d")" in gen-[0-9]*) GEN_DIR="$d"; break ;; esac
    d="$(dirname "$d")"
done

# Infer scenario from sessions.csv when not passed.
if [[ -z "$SCENARIO" && -n "$GEN_DIR" && -f "$GEN_DIR/sessions.csv" ]]; then
    scen_name=$(awk -F, -v run="$LABEL" '$1 == run { print $2; exit }' "$GEN_DIR/sessions.csv")
    if [[ -n "$scen_name" && -f "$IMPROVE_DIR/scenarios/$scen_name" ]]; then
        SCENARIO="$IMPROVE_DIR/scenarios/$scen_name"
    fi
fi

if [[ -z "$OUT" ]]; then
    if [[ -n "$GEN_DIR" ]]; then
        mkdir -p "$GEN_DIR/critiques"
        OUT="$GEN_DIR/critiques/$LABEL.md"
    else
        OUT="./critique-$LABEL.md"
    fi
fi

# --- Assemble the materials document ---------------------------------------
materials() {
    printf '# Session under review: %s\n\n' "$LABEL"

    if [[ -n "$SCENARIO" && -f "$SCENARIO" ]]; then
        printf '## Seed scenario (%s)\n\n%s\n\n' "$(basename "$SCENARIO")" "$(cat "$SCENARIO")"
    else
        printf '## Seed scenario\n\n(unknown — infer from the trajectory'"'"'s message step)\n\n'
    fi

    printf '## Vitals (mechanical)\n\n```\n'
    "$IMPROVE_DIR/vitals.sh" "$TRAJ_FILE" --label "$LABEL" --pretty \
        ${IDENTITY_HOME:+--identity-dir "$IDENTITY_HOME"} 2>/dev/null \
        || printf '(vitals unavailable)\n'
    printf '```\n\n'

    printf '## Trajectory (all steps, content truncated at 2000 chars)\n\n```jsonl\n'
    jq -cR 'fromjson? // empty
            | {ts, step_id, type, source,
               content: ((.content // "") | tostring
                   | if length > 2000 then .[0:2000] + "…[truncated]" else . end)}' \
        "$TRAJ_FILE"
    printf '```\n\n'

    if [[ -n "$IDENTITY_HOME" && -d "$IDENTITY_HOME/run/logs" ]]; then
        printf '## Thinker logs (last 150 lines each)\n\n'
        local log
        for log in "$IDENTITY_HOME/run/logs"/*.log; do
            [[ -f "$log" ]] || continue
            printf '### %s\n\n```\n' "$(basename "$log")"
            tail -n 150 "$log"
            printf '```\n\n'
        done
    fi

    if [[ -n "$IDENTITY_HOME" && -d "$IDENTITY_HOME/memories" ]]; then
        printf '## Memories on disk after the session\n\n```\n'
        ls -1 "$IDENTITY_HOME/memories" 2>/dev/null || true
        printf '```\n'
    fi
}

printf '▶ Critiquing %s with %s\n' "$LABEL" "$MODEL" >&2
materials | llm -m "$MODEL" -t 4096 -s "$(cat "$IMPROVE_DIR/prompts/critic.md")" > "$OUT" \
    || die "llm call failed"

printf '▶ Critique written: %s\n' "$OUT" >&2
printf '%s\n' "$OUT"
