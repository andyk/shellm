#!/usr/bin/env bash
# test_thinkers_pending.sh — pending re-trigger tests for the thinkers dispatcher
#
# Usage:
#   tests/test_thinkers_pending.sh
#
# Builds a throwaway identity with a single slow fake thinker ("slowpoke",
# step = record stdin + sleep 3) and drives the dispatcher through the
# busy/pending/replay lifecycle. No LLM calls, no docker — pure dispatcher
# mechanics. Total runtime ~45s (dominated by slowpoke sleeps + 1s ticks).

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"
PATH="$REPO/bin:$PATH"

pass=0
fail=0
ok()  { pass=$((pass+1)); printf 'ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf 'FAIL %s%s\n' "$1" "${2:+ — $2}"; }

TMP=$(mktemp -d)
TRAJ_ID="cafe0000-0000-0000-0000-000000000001"

env_run() {
    IDENTITY_DIR="$TMP/id" IDENTITY_NAME=testid \
    TRAJ_DIR="$TMP/id/trajectories" TRAJ_ID="$TRAJ_ID" \
    THINKERS_DIR="$TMP/id/thinkers" MEM_DIR="$TMP/id/memories" \
    "$@"
}

cleanup() {
    env_run thinkers stop >/dev/null 2>&1 || true
    rm -rf "$TMP"
}
trap cleanup EXIT

setup_identity() {
    env_run thinkers stop >/dev/null 2>&1 || true
    rm -rf "$TMP/id"
    mkdir -p "$TMP/id/thinkers/slowpoke" "$TMP/id/trajectories/$TRAJ_ID" "$TMP/id/memories"
    printf 'name=testid\ncreated=test\nroot_trajectory=%s\n' "$TRAJ_ID" > "$TMP/id/info.txt"
    : > "$TMP/id/trajectories/$TRAJ_ID/trajectory.jsonl"

    cat > "$TMP/id/thinkers/slowpoke/step" <<'EOF'
#!/usr/bin/env bash
json=$(cat)
printf '%s\n' "$json" >> "$IDENTITY_DIR/record"
sleep 3
EOF
    chmod +x "$TMP/id/thinkers/slowpoke/step"
    printf '{"types":["action","message"]}\n' > "$TMP/id/thinkers/slowpoke/subscriptions.jsonl"
}

append_step() {
    printf '%s\n' "$1" >> "$TMP/id/trajectories/$TRAJ_ID/trajectory.jsonl"
}

start_thinkers() { env_run thinkers start >/dev/null 2>&1; sleep 2; }
stop_thinkers()  { env_run thinkers stop >/dev/null 2>&1; }

record_count() {
    if [[ -f "$TMP/id/record" ]]; then wc -l < "$TMP/id/record" | tr -d ' '; else echo 0; fi
}

# Wait until the record file has at least N lines (or timeout seconds elapse)
wait_for_record() {
    local want="$1" timeout="${2:-15}" i=0
    while [[ "$(record_count)" -lt "$want" && "$i" -lt "$timeout" ]]; do
        sleep 1; i=$((i+1))
    done
}

# ---------------------------------------------------------------------------
# Test 1: a step arriving while the thinker is busy is replayed exactly once,
# with its payload, after the thinker frees up
# ---------------------------------------------------------------------------
test_pending_replay() {
    setup_identity
    start_thinkers

    append_step '{"type":"action","content":"A","source":"test"}'
    sleep 1   # slowpoke picks up A and sleeps
    append_step '{"type":"action","content":"B","source":"test"}'
    sleep 1

    if [[ -f "$TMP/id/run/pending/slowpoke.action" ]]; then
        ok "pending flag set while thinker busy"
    else
        bad "pending flag set while thinker busy"
    fi

    wait_for_record 2
    if [[ "$(record_count)" -eq 2 ]] && tail -1 "$TMP/id/record" | grep -q '"B"'; then
        ok "busy step replayed once with stored payload"
    else
        bad "busy step replayed once with stored payload" "record: $(cat "$TMP/id/record" 2>/dev/null | tr '\n' ' ')"
    fi

    sleep 1
    if [[ ! -f "$TMP/id/run/pending/slowpoke.action" ]]; then
        ok "pending flag cleared after fire"
    else
        bad "pending flag cleared after fire"
    fi

    stop_thinkers
}

# ---------------------------------------------------------------------------
# Test 2: several same-type steps while busy coalesce — only the latest
# replays, and the supersede is logged
# ---------------------------------------------------------------------------
test_supersede_last_wins() {
    setup_identity
    start_thinkers

    append_step '{"type":"action","content":"A","source":"test"}'
    sleep 1
    append_step '{"type":"action","content":"B","source":"test"}'
    sleep 1
    append_step '{"type":"action","content":"C","source":"test"}'

    wait_for_record 2
    local rec
    rec=$(cat "$TMP/id/record" 2>/dev/null)
    if [[ "$(record_count)" -eq 2 ]] && printf '%s' "$rec" | tail -1 | grep -q '"C"' && ! printf '%s' "$rec" | grep -q '"B"'; then
        ok "same-type steps coalesce to latest (B superseded by C)"
    else
        bad "same-type steps coalesce to latest" "record: $(printf '%s' "$rec" | tr '\n' ' ')"
    fi

    if grep -q 'superseded' "$TMP/id/run/logs/dispatcher.log" 2>/dev/null; then
        ok "supersede logged"
    else
        bad "supersede logged"
    fi

    stop_thinkers
}

# ---------------------------------------------------------------------------
# Test 3: pending flags are per-type — an action and a message arriving while
# busy BOTH replay
# ---------------------------------------------------------------------------
test_per_type_flags() {
    setup_identity
    start_thinkers

    append_step '{"type":"action","content":"A","source":"test"}'
    sleep 1
    append_step '{"type":"action","content":"B","source":"test"}'
    append_step '{"type":"message","content":"M","from":"andy","to":"testid","source":"chat"}'
    sleep 1

    local flags
    flags=$(ls "$TMP/id/run/pending" 2>/dev/null | sort | tr '\n' ' ')
    if [[ "$flags" == "slowpoke.action slowpoke.message " ]]; then
        ok "per-type pending flags set (action + message)"
    else
        bad "per-type pending flags set" "flags: $flags"
    fi

    # A (~3s) then B (~3s) then M (~3s), fired by 1s ticks in between
    wait_for_record 3 20
    local rec
    rec=$(cat "$TMP/id/record" 2>/dev/null)
    if [[ "$(record_count)" -eq 3 ]] && printf '%s' "$rec" | grep -q '"B"' && printf '%s' "$rec" | grep -q '"M"'; then
        ok "action and message both replayed"
    else
        bad "action and message both replayed" "record: $(printf '%s' "$rec" | tr '\n' ' ')"
    fi

    stop_thinkers
}

# ---------------------------------------------------------------------------
# Test 4: pending flags are cleared on thinkers stop
# ---------------------------------------------------------------------------
test_cleared_on_stop() {
    setup_identity
    start_thinkers

    append_step '{"type":"action","content":"A","source":"test"}'
    sleep 1
    append_step '{"type":"action","content":"B","source":"test"}'
    sleep 1

    stop_thinkers
    if [[ ! -d "$TMP/id/run/pending" ]]; then
        ok "pending dir removed on stop"
    else
        bad "pending dir removed on stop" "contents: $(ls "$TMP/id/run/pending" 2>/dev/null | tr '\n' ' ')"
    fi
}

# ---------------------------------------------------------------------------
# Test 5: dispatcher singleton — an instance that loses the ownership token
# exits on its next heartbeat instead of double-dispatching forever
# ---------------------------------------------------------------------------
test_singleton_token() {
    setup_identity
    start_thinkers

    local pid
    pid=$(cat "$TMP/id/run/dispatcher.pid" 2>/dev/null)
    if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
        bad "singleton: dispatcher running before token steal"
        stop_thinkers
        return
    fi

    # Simulate a newer instance claiming ownership
    printf 'stolen-token' > "$TMP/id/run/dispatcher.token"

    local i=0
    while kill -0 "$pid" 2>/dev/null && [[ "$i" -lt 5 ]]; do
        sleep 1; i=$((i+1))
    done
    if ! kill -0 "$pid" 2>/dev/null; then
        ok "dispatcher exits after losing ownership token"
    else
        bad "dispatcher exits after losing ownership token" "still alive after 5s"
    fi

    # Its tails must be gone too (no zombie feeders)
    sleep 1
    if ! pgrep -f "tail -n 0 -F $TMP/id/trajectories" >/dev/null 2>&1; then
        ok "orphan tails killed on ownership loss"
    else
        bad "orphan tails killed on ownership loss"
    fi

    # Steps appended now must NOT be dispatched (no live dispatcher)
    append_step '{"type":"action","content":"GHOST","source":"test"}'
    sleep 3
    if ! grep -q '"GHOST"' "$TMP/id/record" 2>/dev/null; then
        ok "no dispatch after ownership loss"
    else
        bad "no dispatch after ownership loss"
    fi

    rm -f "$TMP/id/run/dispatcher.pid"
    stop_thinkers
}

# ---------------------------------------------------------------------------

printf 'test_thinkers_pending: using tmp dir %s\n' "$TMP"
test_pending_replay
test_supersede_last_wins
test_per_type_flags
test_cleared_on_stop
test_singleton_token

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
