#!/usr/bin/env bash
# test_llm_retry.sh — transient-retry behavior of bin/llm
#
# Usage: tests/test_llm_retry.sh
#
# curl is stubbed (mode file drives per-attempt behavior; every call is
# counted), so this exercises the real retry loops: retry on pre-output
# provider errors, no retry after partial streamed output, no retry on 4xx,
# LLM_RETRIES=0 opting out.

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

# --- curl stub ---------------------------------------------------------------
# $CURL_MODE_FILE holds one mode per line; line N applies to call N (last
# line repeats). Modes: err-body | sse-ok | sse-midstream-fail | http-500 |
# http-400 | http-200
mkdir -p "$WORK/bin"
cat > "$WORK/bin/curl" <<'EOF'
#!/usr/bin/env bash
n=$(( $(cat "$CURL_COUNT" 2>/dev/null || echo 0) + 1 ))
printf '%s' "$n" > "$CURL_COUNT"
mode=$(sed -n "${n}p" "$CURL_MODE_FILE")
[[ -z "$mode" ]] && mode=$(tail -1 "$CURL_MODE_FILE")

# detect non-streaming invocation (-o <file> present)
out_file=""
prev=""
for a in "$@"; do
    [[ "$prev" == "-o" ]] && out_file="$a"
    prev="$a"
done

case "$mode" in
    err-body)   # HTTP 200 with an error JSON body, no SSE data (OpenRouter style)
        if [[ -n "$out_file" ]]; then
            printf '{"error":{"message":"Provider returned error","code":502}}' > "$out_file"
            printf '200'
        else
            printf '{"error":{"message":"Provider returned error","code":502}}\n'
        fi
        ;;
    sse-ok)
        printf 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n'
        ;;
    sse-midstream-fail)
        printf 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
        echo "curl: (18) transfer closed with outstanding read data remaining" >&2
        exit 18
        ;;
    http-500)
        printf '{"error":{"message":"upstream exploded"}}' > "$out_file"
        printf '500'
        ;;
    http-400)
        printf '{"error":{"message":"bad request"}}' > "$out_file"
        printf '400'
        ;;
    http-200)
        printf '{"choices":[{"message":{"content":"ok"}}]}' > "$out_file"
        printf '200'
        ;;
esac
EOF
chmod +x "$WORK/bin/curl"
export PATH="$WORK/bin:$PATH"
export OPENROUTER_API_KEY="test-key"
export CURL_COUNT="$WORK/count" CURL_MODE_FILE="$WORK/modes"
export LLM_RETRY_BACKOFF=0

LLM="$REPO/bin/llm"
MODEL="openai/gpt-oss-120b"

run_llm() { "$LLM" -m "$MODEL" "$@" "say ok" 2>"$WORK/stderr"; }
calls() { cat "$CURL_COUNT"; }
reset() { printf '0' > "$CURL_COUNT"; printf '%s\n' "$1" > "$CURL_MODE_FILE"; }

# ---------------------------------------------------------------------------
# Streaming: two provider errors then success -> retried, output intact
# ---------------------------------------------------------------------------

reset $'err-body\nerr-body\nsse-ok'
out=$(LLM_RETRIES=2 run_llm)
check "stream retry succeeds"      test "$?" -eq 0
check "stream output correct"      test "$out" = "ok"
check "three curl calls"           test "$(calls)" = "3"
check "retry noted on stderr"      grep -q "transient API failure (attempt 1/3)" "$WORK/stderr"

# ---------------------------------------------------------------------------
# Streaming: persistent failure -> exhausts retries, fails with orig message
# ---------------------------------------------------------------------------

reset "err-body"
out=$(LLM_RETRIES=2 run_llm)
rc=$?
check "persistent failure fails"     test "$rc" -ne 0
check "no output on failure"         test -z "$out"
check "three attempts then give up"  test "$(calls)" = "3"
check "original error preserved"     grep -q "llm: error: API error: Provider returned error" "$WORK/stderr"

# ---------------------------------------------------------------------------
# LLM_RETRIES=0 restores single-shot behavior
# ---------------------------------------------------------------------------

reset "err-body"
LLM_RETRIES=0 run_llm >/dev/null
check_not "retries=0 fails immediately" test "$(calls)" != "1"
check "single call with retries=0"      test "$(calls)" = "1"

# ---------------------------------------------------------------------------
# Mid-stream failure after output -> NO retry (would duplicate text)
# ---------------------------------------------------------------------------

reset "sse-midstream-fail"
out=$(LLM_RETRIES=2 run_llm)
rc=$?
check "midstream failure is fatal"    test "$rc" -ne 0
check "partial output delivered"      test "$out" = "partial"
check "no retry after emission"       test "$(calls)" = "1"

# ---------------------------------------------------------------------------
# Non-streaming: 5xx retried to success; 400 not retried
# ---------------------------------------------------------------------------

reset $'http-500\nhttp-200'
out=$(LLM_RETRIES=2 run_llm --no-stream)
check "non-stream retry succeeds"     test "$out" = "ok"
check "two calls (500 then 200)"      test "$(calls)" = "2"

reset "http-400"
LLM_RETRIES=2 run_llm --no-stream >/dev/null
rc=$?
check "400 fails"                     test "$rc" -ne 0
check "400 not retried"               test "$(calls)" = "1"
check "400 message surfaced"          grep -q "bad request" "$WORK/stderr"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
