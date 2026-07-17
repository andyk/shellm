#!/usr/bin/env bash
# test_recap.sh — cache/chunking/incremental tests for bin/recap
#
# Usage: tests/test_recap.sh
#
# The `llm` CLI is stubbed (returns canned JSON and logs each call), so this
# exercises the real filtering, windowing, caching, partial-tail redo, and
# output plumbing without network or keys.
#
# Window math under test (window=20, min tail=15):
#   31 signal steps  -> 1 full episode (20), 11-step tail deferred
#   +8  (tail 19)    -> partial episode appended        (2 episodes)
#   +10 (tail 29)    -> partial dropped, full 20 redone (2 episodes), 9 deferred
#   +0               -> no-op, no LLM calls

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

pass=0
fail=0
ok()  { pass=$((pass+1)); printf 'ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf 'FAIL %s%s\n' "$1" "${2:+ — $2}"; }
check() { local label="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$label"; else bad "$label"; fi; }
check_not() { local label="$1"; shift; if "$@" >/dev/null 2>&1; then bad "$label"; else ok "$label"; fi; }

# --- stub llm: window calls get an episode, reduce calls get themes --------
mkdir -p "$WORK/bin"
cat > "$WORK/bin/llm" <<'EOF'
#!/usr/bin/env bash
input=$(cat)
printf 'CALL\n%s\n---\n' "$input" >> "$LLM_LOG"
first_step=$(printf '%s' "$input" | grep -o '\[[0-9a-z?]\{1,8\}\]' | head -1 | tr -d '[]')
if printf '%s' "$input" | grep -q '^EPISODE '; then
    printf '{"arc":"the agent explored and built things","themes":[{"name":"exploration","description":"poking around","episodes":[1],"key_steps":[{"step":"%s","note":"first poke"}]}]}' "$first_step"
else
    n=$(printf '%s' "$input" | wc -l | tr -d ' ')
    printf '{"title":"window of %s steps","summary":"did %s things","themes":["doing-things"],"notable_steps":[{"step":"%s","note":"notable"}]}' "$n" "$n" "$first_step"
fi
EOF
chmod +x "$WORK/bin/llm"
export PATH="$WORK/bin:$REPO/bin:$PATH"
export LLM_LOG="$WORK/llm.log"

# --- synthetic mind log: seeds + idle noise + signal steps ------------------
TRAJ_ROOT="$WORK/trajectories"
RUN="$TRAJ_ROOT/deadbeef-root"
mkdir -p "$RUN"
JSONL="$RUN/trajectory.jsonl"

made=0
step() { # step <type> <id> <content>
    made=$((made+1))
    printf '{"type":"%s","step_id":"%s","ts":"2026-07-17T10:%02d:00","source":"tester","content":"%s"}\n' \
        "$1" "$2" $((made % 60)) "$3" >> "$JSONL"
}
printf '{"type":"trajectory","step_id":"deadbeef-0000-4000-8000-000000000000","ts":"t0"}\n' >> "$JSONL"
printf '{"type":"thought","step_id":"seed0001","source":"seed","content":"seedling thought","ts":"t0"}\n' >> "$JSONL"
for i in $(seq 1 30); do
    step thought "th$(printf '%06d' "$i")" "thinking about topic $i"
    step idle    "id$(printf '%06d' "$i")" "..."
done
step message "msg00001" "hello there"

unset TRAJ_DIR TRAJ_ID RECAP_MODEL SHELLM_FAST_MODEL SHELLM_MODEL 2>/dev/null || true

EPS="$RUN/recap/episodes.jsonl"
THEMES="$RUN/recap/themes.json"
run_recap() { recap deadbeef --traj_dir "$TRAJ_ROOT" --window 20 -q "$@"; }

# ---------------------------------------------------------------------------
# First run: 31 signal steps -> one full episode, 11-step tail deferred
# ---------------------------------------------------------------------------

out=$(run_recap 2>&1)
check "recap runs"           test $? -eq 0
check "episodes cached"      test -s "$EPS"
check "themes cached"        test -s "$THEMES"
check "one episode"          test "$(wc -l < "$EPS" | tr -d ' ')" = "1"
check "episode is full"      test "$(jq -r '.n_steps,.partial' "$EPS" | tr '\n' ' ')" = "20 false "
check_not "idle steps in windows" grep -q 'id000001' "$LLM_LOG"
check_not "seed steps in windows" grep -q 'seedling' "$LLM_LOG"
check "text output has themes"   grep -q "THEMES" <<<"$out"
check "text output has episodes" grep -q "EPISODES" <<<"$out"
check "step refs in output"      grep -q "th000001" <<<"$out"

# cached mode calls no llm
: > "$LLM_LOG"
run_recap --cached >/dev/null 2>&1
check "cached mode calls no llm" test ! -s "$LLM_LOG"

# ---------------------------------------------------------------------------
# +8 steps: 19-step tail (>= min 15, < window) -> partial episode
# ---------------------------------------------------------------------------

for i in $(seq 31 38); do step action "ac$(printf '%06d' "$i")" "acting on $i"; done
: > "$LLM_LOG"
run_recap >/dev/null 2>&1
check "two episodes now"     test "$(wc -l < "$EPS" | tr -d ' ')" = "2"
check "tail episode partial" test "$(tail -1 "$EPS" | jq -r '.n_steps,.partial' | tr '\n' ' ')" = "19 true "
check_not "full episode not redone" grep -q 'thinking about topic 1$' "$LLM_LOG"

# ---------------------------------------------------------------------------
# +10 steps: partial dropped and redone as a full window; 9-step tail deferred
# ---------------------------------------------------------------------------

for i in $(seq 39 48); do step action "ac$(printf '%06d' "$i")" "acting on $i"; done
: > "$LLM_LOG"
run_recap >/dev/null 2>&1
check "still two episodes"    test "$(wc -l < "$EPS" | tr -d ' ')" = "2"
check "redone tail is full"   test "$(tail -1 "$EPS" | jq -r '.n_steps,.partial' | tr '\n' ' ')" = "20 false "
check "redone tail starts at old partial start" \
    test "$(tail -1 "$EPS" | jq -r '.first_step')" = "th000021"
check_not "first episode not redone" grep -q 'thinking about topic 1$' "$LLM_LOG"

# ---------------------------------------------------------------------------
# No new steps: refresh is a no-op
# ---------------------------------------------------------------------------

: > "$LLM_LOG"
run_recap >/dev/null 2>&1
check "no-op refresh calls no llm" test ! -s "$LLM_LOG"

# ---------------------------------------------------------------------------
# JSON output shape
# ---------------------------------------------------------------------------

json=$(run_recap --cached --json)
check "json has arc"        jq -e '.themes.arc | length > 0' <<<"$json"
check "json has episodes"   jq -e '.episodes | length == 2' <<<"$json"
check "json notable steps"  jq -e '.episodes[0].notable_steps[0].step' <<<"$json"

# ---------------------------------------------------------------------------
# Rebuild + locking
# ---------------------------------------------------------------------------

: > "$LLM_LOG"
run_recap --rebuild >/dev/null 2>&1
check "rebuild re-summarizes from scratch" grep -q 'thinking about topic 1$' "$LLM_LOG"

mkdir -p "$RUN/recap/.lock"
check_not "concurrent recap refused" run_recap
rmdir "$RUN/recap/.lock"
check "recap works after lock removed" run_recap --cached

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
