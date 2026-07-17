#!/usr/bin/env bash
# test_thinkers_drain.sh — drain-stop semantics for `thinkers stop`
#
# Usage: tests/test_thinkers_drain.sh
#
# Uses real processes (sleep) as fake in-flight steps: default stop must
# deactivate immediately but let them live; the detached reaper must run
# stop scripts after they exit; --force and the drain timeout must kill.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"
PATH="$REPO/bin:$PATH"

WORK=$(mktemp -d)
cleanup() { pkill -f "drain-test-sentinel" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

pass=0
fail=0
ok()  { pass=$((pass+1)); printf 'ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf 'FAIL %s%s\n' "$1" "${2:+ — $2}"; }
check() { local label="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$label"; else bad "$label"; fi; }
check_not() { local label="$1"; shift; if "$@" >/dev/null 2>&1; then bad "$label"; else ok "$label"; fi; }

# wait_until <seconds> <command...>
wait_until() {
    local deadline=$(( $(date +%s) + $1 )); shift
    while ! "$@" >/dev/null 2>&1; do
        [[ $(date +%s) -ge $deadline ]] && return 1
        sleep 0.2
    done
}

# --- fake identity ----------------------------------------------------------
IDENTITY="$WORK/.identities/drainy"
RUN="$IDENTITY/run"
mkdir -p "$IDENTITY/thinkers/alpha" "$IDENTITY/thinkers/beta" "$RUN/thinkers" \
         "$IDENTITY/trajectories"
printf 'name=drainy\ncreated=x\nroot_trajectory=dddddddd-1111-4111-8111-111111111111\n' > "$IDENTITY/info.txt"
for t in alpha beta; do
    printf '#!/usr/bin/env bash\ncat >/dev/null\n' > "$IDENTITY/thinkers/$t/step"
    printf '#!/usr/bin/env bash\ntouch "%s/%s.stop-ran"\n' "$WORK" "$t" > "$IDENTITY/thinkers/$t/stop"
    chmod +x "$IDENTITY/thinkers/$t/step" "$IDENTITY/thinkers/$t/stop"
    echo '{}' > "$IDENTITY/thinkers/$t/subscriptions.jsonl"
done

env_thinkers() {
    IDENTITY_DIR="$IDENTITY" IDENTITY_NAME=drainy THINKERS_DIR="$IDENTITY/thinkers" \
    TRAJ_DIR="$IDENTITY/trajectories" TRAJ_ID="dddddddd-1111-4111-8111-111111111111" \
    thinkers "$@"
}

spawn_step() { # spawn_step <thinker> <seconds> -> pid
    # fds detached: this runs inside $(...) and an inherited stdout pipe
    # would make the command substitution block until the sleep exits
    bash -c "exec -a drain-test-sentinel sleep $2" </dev/null >/dev/null 2>&1 &
    local pid=$!
    printf '%s %s\n' "$pid" "$1" >> "$RUN/step_pids"
    printf '%s\n' "$pid"
}

# ---------------------------------------------------------------------------
# Named drain stop: deactivates now, lets the step finish, then cleans up
# ---------------------------------------------------------------------------

printf 'alpha\nbeta\n' > "$RUN/active_thinkers"
: > "$RUN/step_pids"
PID_A=$(spawn_step alpha 3)

start=$(date +%s)
env_thinkers stop alpha >/dev/null 2>&1
elapsed=$(( $(date +%s) - start ))

check "stop returns immediately (took ${elapsed}s)" test "$elapsed" -le 2
check "alpha removed from active_thinkers" bash -c "! grep -qx alpha '$RUN/active_thinkers'"
check "beta still active" grep -qx beta "$RUN/active_thinkers"
check "in-flight step still alive (draining)" kill -0 "$PID_A"
check_not "stop script not run yet" test -f "$WORK/alpha.stop-ran"

check "step finishes naturally" wait_until 6 bash -c "! kill -0 $PID_A"
check "reaper ran stop script after drain" wait_until 6 test -f "$WORK/alpha.stop-ran"

# ---------------------------------------------------------------------------
# --force kills the in-flight step immediately
# ---------------------------------------------------------------------------

rm -f "$WORK"/*.stop-ran
printf 'alpha\nbeta\n' > "$RUN/active_thinkers"
: > "$RUN/step_pids"
PID_A=$(spawn_step alpha 60)

env_thinkers stop --force alpha >/dev/null 2>&1
check "force kills step quickly" wait_until 3 bash -c "! kill -0 $PID_A"
check "force runs stop script inline" test -f "$WORK/alpha.stop-ran"

# ---------------------------------------------------------------------------
# Drain timeout escalates to kill
# ---------------------------------------------------------------------------

rm -f "$WORK"/*.stop-ran
printf 'alpha\nbeta\n' > "$RUN/active_thinkers"
: > "$RUN/step_pids"
PID_A=$(spawn_step alpha 120)

env_thinkers stop --drain-timeout 2 alpha >/dev/null 2>&1
check "step alive right after drain stop" kill -0 "$PID_A"
check "timeout escalation kills the step" wait_until 10 bash -c "! kill -0 $PID_A"
check "stop script runs after escalation" wait_until 6 test -f "$WORK/alpha.stop-ran"

# ---------------------------------------------------------------------------
# Stop-all drain: everything deactivated, steps drain, ledger cleared after
# ---------------------------------------------------------------------------

rm -f "$WORK"/*.stop-ran
printf 'alpha\nbeta\n' > "$RUN/active_thinkers"
: > "$RUN/step_pids"
PID_A=$(spawn_step alpha 3)
PID_B=$(spawn_step beta 3)

env_thinkers stop >/dev/null 2>&1
check "stop-all deactivates immediately" test ! -s "$RUN/active_thinkers" -o ! -f "$RUN/active_thinkers"
check "both steps still alive (draining)" bash -c "kill -0 $PID_A && kill -0 $PID_B"
check "steps drain out" wait_until 8 bash -c "! kill -0 $PID_A && ! kill -0 $PID_B"
check "stop scripts ran for both" wait_until 6 bash -c "test -f '$WORK/alpha.stop-ran' && test -f '$WORK/beta.stop-ran'"
check "step ledger cleared by reaper" wait_until 6 bash -c "test ! -f '$RUN/step_pids'"

# ---------------------------------------------------------------------------
# Stop-all --force keeps the old immediate-kill behavior
# ---------------------------------------------------------------------------

rm -f "$WORK"/*.stop-ran
printf 'alpha\nbeta\n' > "$RUN/active_thinkers"
: > "$RUN/step_pids"
PID_A=$(spawn_step alpha 60)

env_thinkers stop --force >/dev/null 2>&1
check "force stop-all kills immediately" wait_until 4 bash -c "! kill -0 $PID_A"
check "force stop-all runs stop scripts" test -f "$WORK/alpha.stop-ran"
check "force stop-all clears ledger" test ! -f "$RUN/step_pids"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
