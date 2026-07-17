#!/usr/bin/env bash
set -euo pipefail

# improve/session.sh — Observe stage: run one bounded autonomous session.
#
# Creates a fresh identity under the current generation, starts a minimal
# thinker roster (inner_monologue + actor), seeds a scenario message, lets the
# mind run for a bounded window, stops it, and records vitals. The identity
# directory (trajectories, memories, thinker logs) IS the session artifact.

usage() {
    cat <<'USAGE'
Usage: improve/session.sh [options]

Options:
  --scenario FILE   Seed stimulus sent as a chat message (default: scenarios/orient.md)
  --seconds S       Session duration in seconds (default: 60)
  --minutes M       Session duration in minutes (overrides --seconds)
  --thinkers CSV    Thinker roster (default: inner_monologue,actor)
  --model MODEL     Thinker model (THINK_MODEL; default: identity default)
  --memories DIR    Seed the new identity's memories from DIR (cross-session learning)
  --gen N           Generation number (default: highest existing, or 1)
  --new-gen         Start the next generation
  --local           Run thinker shellm calls on the host (no Docker)
  -h, --help        Show this help
USAGE
    exit "${1:-0}"
}

die() { printf 'session: error: %s\n' "$*" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMPROVE_DIR="$REPO_ROOT/improve"
export PATH="$REPO_ROOT/bin:$PATH"
# shellcheck disable=SC1091
if [[ -f "$REPO_ROOT/.env" ]]; then set -a; source "$REPO_ROOT/.env"; set +a; fi

SCENARIO="$IMPROVE_DIR/scenarios/orient.md"
DURATION_SECS=60
THINKERS_CSV="inner_monologue,actor"
MODEL=""
MEMORIES_DIR=""
GEN_NUM=""
NEW_GEN=0
LOCAL_ENV=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --scenario) SCENARIO="${2:?--scenario requires a file}"; shift 2 ;;
        --seconds)  DURATION_SECS="${2:?--seconds requires a number}"; shift 2 ;;
        --minutes)  DURATION_SECS=$(( ${2:?--minutes requires a number} * 60 )); shift 2 ;;
        --thinkers) THINKERS_CSV="${2:?--thinkers requires a csv list}"; shift 2 ;;
        --model)    MODEL="${2:?--model requires a value}"; shift 2 ;;
        --memories) MEMORIES_DIR="${2:?--memories requires a directory}"; shift 2 ;;
        --gen)      GEN_NUM="${2:?--gen requires a number}"; shift 2 ;;
        --new-gen)  NEW_GEN=1; shift ;;
        --local)    LOCAL_ENV=1; shift ;;
        -h|--help)  usage ;;
        *)          die "unknown option: $1" ;;
    esac
done

[[ -f "$SCENARIO" ]] || die "scenario file not found: $SCENARIO"
[[ "$DURATION_SECS" =~ ^[0-9]+$ ]] || die "duration must be an integer number of seconds"
[[ -z "$MEMORIES_DIR" || -d "$MEMORIES_DIR" ]] || die "--memories: not a directory: $MEMORIES_DIR"

# Never inherit an active identity shell.
unset IDENTITY_NAME IDENTITY_DIR MEM_DIR SKILLS_DIR SKILLS_KERNEL_DIR TRAJ_DIR TRAJ_ID \
    ROOT_TRAJ_ID THINKERS_DIR SKILLSRC SHELLM_TRAJ_DIR SHELLM_ENVS_DIR SHELLM_WORKDIRS_DIR \
    SHELLM_BROKER_DIR SHELLM_CONF_DIR CHATRC 2>/dev/null || true

# --- Resolve generation directory -----------------------------------------
GENERATIONS_DIR="$IMPROVE_DIR/generations"
mkdir -p "$GENERATIONS_DIR"

latest_gen_num() {
    local d n max=0
    for d in "$GENERATIONS_DIR"/gen-*/; do
        [[ -d "$d" ]] || continue
        n=$(basename "$d"); n="${n#gen-}"; n=$((10#$n))
        if (( n > max )); then max=$n; fi
    done
    printf '%s' "$max"
}

if [[ -n "$GEN_NUM" ]]; then
    :
elif [[ "$NEW_GEN" -eq 1 ]]; then
    GEN_NUM=$(( $(latest_gen_num) + 1 ))
else
    GEN_NUM=$(latest_gen_num)
    if (( GEN_NUM == 0 )); then GEN_NUM=1; fi
fi
GEN_DIR=$(printf '%s/gen-%03d' "$GENERATIONS_DIR" "$GEN_NUM")
mkdir -p "$GEN_DIR/identities" "$GEN_DIR/critiques"

# --- Create a fresh identity for this run ---------------------------------
run_num=1
while [[ -d "$GEN_DIR/identities/$(printf 'g%03dr%d' "$GEN_NUM" "$run_num")" ]]; do
    run_num=$(( run_num + 1 ))
done
RUN_NAME=$(printf 'g%03dr%d' "$GEN_NUM" "$run_num")

printf '▶ Creating identity %s (gen %d, run %d)\n' "$RUN_NAME" "$GEN_NUM" "$run_num" >&2
id_args=()
if [[ -n "$MEMORIES_DIR" ]]; then id_args+=(--memories "$MEMORIES_DIR"); fi
IDENTITY_DIR="$GEN_DIR/identities" identity new "${id_args[@]+"${id_args[@]}"}" "$RUN_NAME"

IDENTITY_HOME="$GEN_DIR/identities/$RUN_NAME"
# The activate script is written for interactive shells; relax -eu around it.
set +eu
# shellcheck disable=SC1091
source "$IDENTITY_HOME/activate"
set -eu

[[ -n "${IDENTITY_NAME:-}" ]] || die "identity activation failed for $IDENTITY_HOME"
if [[ -n "$MODEL" ]]; then export THINK_MODEL="$MODEL"; fi
if [[ "$LOCAL_ENV" -eq 1 ]]; then export SHELLM_THINKER_ENV="local"; fi

# --- Cleanup on exit: stop thinkers, remove session Docker containers ------
cleanup() {
    # --force: this harness wants the hard cutoff — it immediately snapshots
    # the trajectory and tears down session containers, so draining steps
    # would race both.
    thinkers stop --force >/dev/null 2>&1 || true
    # Defense in depth: bin/thinkers sweeps leaked tail feeders on stop, but
    # a hard-killed session can still strand them; ours are precisely
    # identifiable by this identity's traj dir.
    pkill -f "tail -n 0 -F $TRAJ_DIR" 2>/dev/null || true
    if command -v docker >/dev/null 2>&1 && [[ -d "${SHELLM_ENVS_DIR:-}" ]]; then
        local env_dir cid
        for env_dir in "$SHELLM_ENVS_DIR"/*/; do
            [[ -f "$env_dir/container_id" ]] || continue
            cid=$(cat "$env_dir/container_id" 2>/dev/null) || true
            [[ -n "$cid" ]] && docker rm -f "$cid" >/dev/null 2>&1 || true
        done
    fi
}
trap cleanup EXIT INT TERM

# --- Seed the scenario as a chat message, then start the mind --------------
scenario_text=$(cat "$SCENARIO")
printf '▶ Seeding scenario: %s\n' "$(basename "$SCENARIO")" >&2
printf '{"type":"message","content":%s,"from":"nick","to":%s,"source":"chat"}' \
    "$(printf '%s' "$scenario_text" | jq -Rsa .)" \
    "$(printf '%s' "$IDENTITY_NAME" | jq -Rsa .)" \
    | traj append >/dev/null

IFS=',' read -r -a thinker_roster <<< "$THINKERS_CSV"
printf '▶ Starting thinkers: %s (model: %s)\n' "$THINKERS_CSV" "${THINK_MODEL:-default}" >&2
thinkers start "${thinker_roster[@]}"

started_at=$(date +%Y-%m-%dT%H:%M:%S)
printf '▶ Mind running for %ss — watch with: traj tail -f --traj_dir %s %s\n' \
    "$DURATION_SECS" "$TRAJ_DIR" "$TRAJ_ID" >&2
sleep "$DURATION_SECS"

printf '▶ Stopping thinkers\n' >&2
thinkers stop --force || true  # hard session boundary: eval snapshot follows immediately
ended_at=$(date +%Y-%m-%dT%H:%M:%S)

# --- Locate trajectory file and record the session -------------------------
hex_prefix="${TRAJ_ID%%-*}"
traj_file=$(find "$TRAJ_DIR" -type d -name "${hex_prefix}-*" 2>/dev/null | head -1)/trajectory.jsonl
[[ -f "$traj_file" ]] || traj_file="$TRAJ_DIR/$TRAJ_ID/trajectory.jsonl"
[[ -f "$traj_file" ]] || die "could not locate trajectory file under $TRAJ_DIR"

steps=$(wc -l < "$traj_file" | tr -d ' ')

sessions_csv="$GEN_DIR/sessions.csv"
[[ -f "$sessions_csv" ]] || printf 'run,scenario,seconds,model,started,ended,steps,traj_file\n' > "$sessions_csv"
printf '%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$RUN_NAME" "$(basename "$SCENARIO")" "$DURATION_SECS" "${THINK_MODEL:-default}" \
    "$started_at" "$ended_at" "$steps" "$traj_file" >> "$sessions_csv"

# --- Vitals -----------------------------------------------------------------
vitals_csv="$GEN_DIR/vitals.csv"
vitals_args=(--label "$RUN_NAME" --identity-dir "$IDENTITY_HOME")
[[ -f "$vitals_csv" ]] || "$IMPROVE_DIR/vitals.sh" --header > "$vitals_csv"
"$IMPROVE_DIR/vitals.sh" "$traj_file" "${vitals_args[@]}" >> "$vitals_csv" \
    || printf 'session: warning: vitals failed for %s\n' "$RUN_NAME" >&2

printf '\n▶ Session %s complete: %s steps\n' "$RUN_NAME" "$steps" >&2
printf '  trajectory: %s\n' "$traj_file" >&2
printf '  thinker logs: %s/run/logs/\n' "$IDENTITY_HOME" >&2
printf '  vitals: %s\n' "$vitals_csv" >&2
printf '  next: improve/critique.sh %s\n' "$traj_file" >&2

# stdout contract: print the trajectory path so callers can pipe it onward
printf '%s\n' "$traj_file"
