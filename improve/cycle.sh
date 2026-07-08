#!/usr/bin/env bash
set -euo pipefail

# improve/cycle.sh — Meta-harness: run stages 1-4 of the loop unattended.
#
# For each scenario: run a session (observe+measure), then critique it.
# After all sessions: synthesize proposal cards. Stops at the human stage:
# reviewing proposals/ and moving winners to accepted/.
#
# Memory chaining: a scenario may have a sidecar file `<name>.memories-from`
# containing another scenario's filename; its session is then seeded with the
# memories of that scenario's run from THIS cycle (e.g. pipes-recall.md chains
# off pipes-note.md).

usage() {
    cat <<'USAGE'
Usage: improve/cycle.sh [options]

Options:
  --scenario FILE     Scenario to include (repeatable; default: all scenarios/*.md)
  --seconds S         Session duration (default: 60)
  --minutes M         Session duration in minutes (overrides --seconds)
  --model MODEL       Mind model for sessions (default: claude-sonnet-5)
  --critic-model M    Critic/synthesizer model (default: critique.sh/synthesize.sh defaults)
  --gen N             Generation number (default: current)
  --new-gen           Start the next generation
  --local             Run thinker shellm calls on the host (no Docker)
  -h, --help          Show this help
USAGE
    exit "${1:-0}"
}

die() { printf 'cycle: error: %s\n' "$*" >&2; exit 1; }
warn() { printf 'cycle: warning: %s\n' "$*" >&2; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMPROVE_DIR="$REPO_ROOT/improve"
export PATH="$REPO_ROOT/bin:$PATH"
# shellcheck disable=SC1091
if [[ -f "$REPO_ROOT/.env" ]]; then set -a; source "$REPO_ROOT/.env"; set +a; fi

SCENARIOS=()
DURATION_SECS=60
MIND_MODEL="claude-sonnet-5"
CRITIC_MODEL=""
GEN_NUM=""
NEW_GEN=0
LOCAL_ENV=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --scenario)     SCENARIOS+=("${2:?--scenario requires a file}"); shift 2 ;;
        --seconds)      DURATION_SECS="${2:?--seconds requires a number}"; shift 2 ;;
        --minutes)      DURATION_SECS=$(( ${2:?--minutes requires a number} * 60 )); shift 2 ;;
        --model)        MIND_MODEL="${2:?--model requires a value}"; shift 2 ;;
        --critic-model) CRITIC_MODEL="${2:?--critic-model requires a value}"; shift 2 ;;
        --gen)          GEN_NUM="${2:?--gen requires a number}"; shift 2 ;;
        --new-gen)      NEW_GEN=1; shift ;;
        --local)        LOCAL_ENV=1; shift ;;
        -h|--help)      usage ;;
        *)              die "unknown option: $1" ;;
    esac
done

if [[ ${#SCENARIOS[@]} -eq 0 ]]; then
    shopt -s nullglob
    SCENARIOS=("$IMPROVE_DIR/scenarios"/*.md)
    shopt -u nullglob
fi
[[ ${#SCENARIOS[@]} -gt 0 ]] || die "no scenarios found"
for s in "${SCENARIOS[@]}"; do
    [[ -f "$s" ]] || die "scenario not found: $s"
done

# Parallel arrays (bash 3.2): scenario basename → identity dir of its run
RAN_NAMES=()
RAN_HOMES=()
TRAJS=()
CRITIQUES=0
GEN_DIR=""

lookup_run_home() {
    local want="$1" i
    [[ ${#RAN_NAMES[@]} -gt 0 ]] || return 1
    for i in "${!RAN_NAMES[@]}"; do
        if [[ "${RAN_NAMES[$i]}" == "$want" ]]; then
            printf '%s' "${RAN_HOMES[$i]}"
            return 0
        fi
    done
    return 1
}

total=${#SCENARIOS[@]}
n=0
for scen in "${SCENARIOS[@]}"; do
    n=$(( n + 1 ))
    scen_name=$(basename "$scen")
    printf '\n═══ cycle: session %d/%d — %s ═══\n' "$n" "$total" "$scen_name" >&2

    args=(--scenario "$scen" --seconds "$DURATION_SECS" --model "$MIND_MODEL")
    if [[ "$LOCAL_ENV" -eq 1 ]]; then args+=(--local); fi
    if [[ -n "$GEN_NUM" ]]; then
        args+=(--gen "$GEN_NUM")
    elif [[ "$NEW_GEN" -eq 1 && "$n" -eq 1 ]]; then
        args+=(--new-gen)   # later sessions default to the (now-latest) new gen
    fi

    # Memory chaining via sidecar
    sidecar="${scen%.md}.memories-from"
    if [[ -f "$sidecar" ]]; then
        ref=$(tr -d '[:space:]' < "$sidecar")
        if ref_home=$(lookup_run_home "$ref"); then
            printf 'cycle: seeding memories from %s (%s)\n' "$ref" "$ref_home" >&2
            args+=(--memories "$ref_home/memories")
        else
            warn "$scen_name chains off $ref, which did not run this cycle — running without memories"
        fi
    fi

    if ! traj=$("$IMPROVE_DIR/session.sh" "${args[@]}"); then
        warn "session failed for $scen_name — skipping its critique"
        continue
    fi
    traj=$(printf '%s\n' "$traj" | tail -1)
    identity_home="$(dirname "$(dirname "$(dirname "$traj")")")"

    RAN_NAMES+=("$scen_name")
    RAN_HOMES+=("$identity_home")
    TRAJS+=("$traj")

    # Locate the generation dir from the first successful run
    if [[ -z "$GEN_DIR" ]]; then
        d="$identity_home"
        while [[ "$d" != "/" ]]; do
            case "$(basename "$d")" in gen-[0-9]*) GEN_DIR="$d"; break ;; esac
            d="$(dirname "$d")"
        done
    fi

    printf '\n═══ cycle: critique %d/%d — %s ═══\n' "$n" "$total" "$scen_name" >&2
    crit_args=()
    if [[ -n "$CRITIC_MODEL" ]]; then crit_args+=(--model "$CRITIC_MODEL"); fi
    if "$IMPROVE_DIR/critique.sh" "$traj" "${crit_args[@]+"${crit_args[@]}"}" >/dev/null; then
        CRITIQUES=$(( CRITIQUES + 1 ))
    else
        warn "critique failed for $scen_name (session artifacts kept; rerun critique.sh manually)"
    fi
done

[[ ${#TRAJS[@]} -gt 0 ]] || die "no sessions succeeded"
[[ "$CRITIQUES" -gt 0 ]] || die "no critiques succeeded — nothing to synthesize"
[[ -n "$GEN_DIR" ]] || die "could not locate generation directory"

printf '\n═══ cycle: synthesize (%d critiques) ═══\n' "$CRITIQUES" >&2
syn_args=(--gen "$GEN_DIR")
if [[ -n "$CRITIC_MODEL" ]]; then syn_args+=(--model "$CRITIC_MODEL"); fi
"$IMPROVE_DIR/synthesize.sh" "${syn_args[@]}"

printf '\n═══ cycle complete: %s ═══\n' "$(basename "$GEN_DIR")" >&2
printf 'Sessions:  %d/%d succeeded\n' "${#TRAJS[@]}" "$total" >&2
printf 'Critiques: %d\n' "$CRITIQUES" >&2
printf 'Vitals:    %s/vitals.csv\n' "$GEN_DIR" >&2
printf '\nYour turn (decide + apply):\n' >&2
printf '  cat %s/proposals/*.md\n' "$GEN_DIR" >&2
printf '  mv %s/proposals/<card>.md %s/accepted/\n' "$GEN_DIR" "$GEN_DIR" >&2
printf '  improve/apply.sh %s/accepted/<card>.md\n' "$GEN_DIR" >&2
