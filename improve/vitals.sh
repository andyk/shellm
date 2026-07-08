#!/usr/bin/env bash
set -euo pipefail

# improve/vitals.sh — Measure stage: mechanical psychometrics for one session.
#
# Pure bash + jq, no LLM. These are the μ proxies for the current sub-goals
# (on-rails-ness, grounded action, learning, self-direction). Emits one CSV
# row on stdout (or a pretty report with --pretty).

usage() {
    cat <<'USAGE'
Usage: improve/vitals.sh <trajectory.jsonl> [options]
       improve/vitals.sh --header

Options:
  --label NAME        Row label (default: trajectory's parent dir name)
  --identity-dir DIR  Identity dir, enables memory + thinker-log metrics
  --pretty            Human-readable report instead of a CSV row
  --header            Print the CSV header line and exit
  -h, --help          Show this help
USAGE
    exit "${1:-0}"
}

die() { printf 'vitals: error: %s\n' "$*" >&2; exit 1; }

HEADER='label,steps,thoughts,actions,observations,messages,dup_thoughts,dup_thought_rate,follow_through,max_gap_s,mem_files,log_errors'

TRAJ_FILE=""
LABEL=""
IDENTITY_HOME=""
PRETTY=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --header)       printf '%s\n' "$HEADER"; exit 0 ;;
        --label)        LABEL="${2:?--label requires a value}"; shift 2 ;;
        --identity-dir) IDENTITY_HOME="${2:?--identity-dir requires a directory}"; shift 2 ;;
        --pretty)       PRETTY=1; shift ;;
        -h|--help)      usage ;;
        -*)             die "unknown option: $1" ;;
        *)              [[ -n "$TRAJ_FILE" ]] && die "unexpected argument: $1"; TRAJ_FILE="$1"; shift ;;
    esac
done

[[ -n "$TRAJ_FILE" ]] || usage 1
[[ -f "$TRAJ_FILE" ]] || die "trajectory file not found: $TRAJ_FILE"
[[ -n "$LABEL" ]] || LABEL=$(basename "$(dirname "$TRAJ_FILE")")

# Tolerant parse: skip corrupt lines (concurrent appends can produce them).
valid_steps() { jq -cR 'fromjson? // empty' "$TRAJ_FILE"; }

count_type() { valid_steps | jq -r '.type' | grep -cx "$1" || true; }

steps=$(valid_steps | wc -l | tr -d ' ')
thoughts=$(count_type thought)
actions=$(count_type action)
observations=$(count_type observation)
messages=$(count_type message)

# Thought repetition: exact duplicates after normalization (lowercase,
# alnum+space only, squeezed). Crude, but loops of restated intent show up.
dup_thoughts=0
if (( thoughts > 0 )); then
    dup_thoughts=$(valid_steps \
        | jq -r 'select(.type=="thought") | (.content // "") | tostring
                 | ascii_downcase | gsub("[^a-z0-9 ]"; " ") | gsub(" +"; " ")' \
        | sort | uniq -dc | awk '{ n += $1 - 1 } END { print n + 0 }')
fi
dup_rate=$(awk -v d="$dup_thoughts" -v t="$thoughts" 'BEGIN { printf (t>0 ? "%.2f" : "0.00"), (t>0 ? d/t : 0) }')

# Grounded action: observations per action (>1 possible; 0 means actions
# fired but nothing came back).
follow_through=$(awk -v o="$observations" -v a="$actions" 'BEGIN { printf (a>0 ? "%.2f" : "na"), (a>0 ? o/a : 0) }')

# On-rails: longest silence between consecutive steps, in seconds.
max_gap=$(valid_steps \
    | jq -rs 'map(.ts // empty | .[0:19] | strptime("%Y-%m-%dT%H:%M:%S") | mktime)
              | if length < 2 then 0
                else . as $t | [range(1; length) | $t[.] - $t[.-1]] | max end')

# Learning: memories on disk after the session.
mem_files="na"
log_errors="na"
if [[ -n "$IDENTITY_HOME" ]]; then
    [[ -d "$IDENTITY_HOME" ]] || die "identity dir not found: $IDENTITY_HOME"
    mem_files=$(find "$IDENTITY_HOME/memories" -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
    log_errors=0
    if [[ -d "$IDENTITY_HOME/run/logs" ]]; then
        log_errors=$(cat "$IDENTITY_HOME/run/logs"/*.log 2>/dev/null \
            | grep -ci 'error' || true)
    fi
fi

if [[ "$PRETTY" -eq 1 ]]; then
    cat <<REPORT
Vitals: $LABEL
  steps total        $steps
  thoughts           $thoughts (duplicates: $dup_thoughts, rate: $dup_rate)
  actions            $actions
  observations       $observations (follow-through: $follow_through per action)
  messages           $messages
  max step gap       ${max_gap}s
  memory files       $mem_files
  thinker log errors $log_errors
REPORT
else
    printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
        "$LABEL" "$steps" "$thoughts" "$actions" "$observations" "$messages" \
        "$dup_thoughts" "$dup_rate" "$follow_through" "$max_gap" "$mem_files" "$log_errors"
fi
