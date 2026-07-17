#!/usr/bin/env bash
# test_identity_export_import.sh — round-trip tests for `identity export` / `identity import`
#
# Usage: tests/test_identity_export_import.sh
#
# Exercises the real tar/find/jq pipeline: exclusion rules, manifest contents,
# rename on import, soul-only re-rooting, multi-identity archives, conflict
# detection, and rejection of path-escaping archives.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"

PATH="$REPO/bin:$PATH"
unset IDENTITY_NAME IDENTITY_DIR MEM_DIR SKILLS_DIR TRAJ_DIR TRAJ_ID 2>/dev/null || true

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

pass=0
fail=0
ok()  { pass=$((pass+1)); printf 'ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf 'FAIL %s%s\n' "$1" "${2:+ — $2}"; }

check() {
    # check <label> <command...>
    local label="$1"; shift
    if "$@" >/dev/null 2>&1; then ok "$label"; else bad "$label"; fi
}

check_not() {
    # check_not <label> <command...> — passes when the command fails
    local label="$1"; shift
    if "$@" >/dev/null 2>&1; then bad "$label"; else ok "$label"; fi
}

# ---------------------------------------------------------------------------
# Fixture: root A with identity "alpha" (memory, secret, runtime state)
# ---------------------------------------------------------------------------

ROOT_A="$WORK/rootA"
mkdir -p "$ROOT_A"
(cd "$ROOT_A" && identity new alpha >/dev/null 2>&1) || { bad "identity new alpha"; exit 1; }
ALPHA="$ROOT_A/.identities/alpha"
echo "remember the fixture" > "$ALPHA/memories/2026-01-01-00-00-00_fixture.md"
# Agents have created memory filenames containing newlines (mem slugs from
# multi-line titles); export must carry them, not choke on them.
NL_MEM="$ALPHA/memories/2026-01-02-00-00-00_weird
multi-line-name.md"
echo "newline name" > "$NL_MEM"
echo "ANTHROPIC_API_KEY=sk-secret" > "$ALPHA/.env"
mkdir -p "$ALPHA/run" "$ALPHA/.shellm/envs/e1"
mkfifo "$ALPHA/run/dispatch.fifo"
echo "cid" > "$ALPHA/.shellm/envs/e1/container_id"
ALPHA_RT=$(grep '^root_trajectory=' "$ALPHA/info.txt" | cut -d= -f2-)

# ---------------------------------------------------------------------------
# Export: exclusions + manifest
# ---------------------------------------------------------------------------

TGZ="$WORK/alpha.tgz"
(cd "$ROOT_A" && identity export alpha -o "$TGZ" 2>/dev/null)
check "export produces archive" test -s "$TGZ"

members=$(tar -tzf "$TGZ")
check "archive has manifest.json"      grep -qx 'manifest.json' <<<"$members"
check "archive has memory"             grep -q 'alpha/memories/2026-01-01-00-00-00_fixture.md' <<<"$members"
check "archive has trajectory"         grep -q 'alpha/trajectories/.*/trajectory.jsonl' <<<"$members"
check "archive has thinker step"       grep -q 'alpha/thinkers/inner_monologue/step' <<<"$members"
check_not "archive omits run/"         grep -q 'alpha/run' <<<"$members"
check_not "archive omits .shellm/"     grep -q 'alpha/.shellm' <<<"$members"
check_not "archive omits .env"         grep -q 'alpha/.env' <<<"$members"
check_not "archive omits kernel/"      grep -q 'alpha/kernel' <<<"$members"
check_not "archive omits activate"     grep -q 'alpha/activate' <<<"$members"

manifest=$(tar -xzOf "$TGZ" manifest.json)
check "manifest format 1"    test "$(jq -r '.format' <<<"$manifest")" = "1"
check "manifest name"        test "$(jq -r '.identities[0].name' <<<"$manifest")" = "alpha"
check "manifest memories"    test "$(jq -r '.identities[0].memories' <<<"$manifest")" = "2"
check "manifest root traj"   test "$(jq -r '.identities[0].root_trajectory' <<<"$manifest")" = "$ALPHA_RT"

# Thinker step files must be real files (dereferenced), not symlinks
step_type=$(tar -tvzf "$TGZ" | grep 'alpha/thinkers/inner_monologue/step' | head -1 | cut -c1)
check "thinker step dereferenced" test "$step_type" = "-"

# ---------------------------------------------------------------------------
# Import with rename into a fresh root
# ---------------------------------------------------------------------------

ROOT_B="$WORK/rootB"
mkdir -p "$ROOT_B"
out=$(cd "$ROOT_B" && identity import "$TGZ" --name beta 2>/dev/null)
check "import prints new name"   test "$out" = "beta"
BETA="$ROOT_B/.identities/beta"
check "imported dir exists"      test -d "$BETA"
check "info.txt renamed"         grep -qx 'name=beta' "$BETA/info.txt"
check "memory travelled"         test -f "$BETA/memories/2026-01-01-00-00-00_fixture.md"
check "newline-name memory travelled" test -f "$BETA/memories/2026-01-02-00-00-00_weird
multi-line-name.md"
check "root trajectory kept"     grep -qx "root_trajectory=$ALPHA_RT" "$BETA/info.txt"
check "trajectory jsonl present" test -f "$BETA/trajectories/${ALPHA_RT:0:8}-root/trajectory.jsonl"
check "kernel regenerated"       test -e "$BETA/kernel/mem/SKILL.md"
check "activate regenerated"     test -f "$BETA/activate"
check "no .env imported"         test ! -e "$BETA/.env"
check "no run/ imported"         test ! -e "$BETA/run"
check "default symlink set"      test "$(readlink "$ROOT_B/.identities/default")" = "beta"

# Re-import without rename lands as "alpha" alongside beta
(cd "$ROOT_B" && identity import "$TGZ" >/dev/null 2>&1)
check "second import as original name" test -d "$ROOT_B/.identities/alpha"

# Conflicting import is refused
if (cd "$ROOT_B" && identity import "$TGZ" >/dev/null 2>&1); then
    bad "conflict refused"
else
    ok "conflict refused"
fi

# ---------------------------------------------------------------------------
# Soul-only export: no trajectories; import mints a fresh root trajectory
# ---------------------------------------------------------------------------

SOUL="$WORK/soul.tgz"
(cd "$ROOT_A" && identity export alpha --soul-only -o "$SOUL" 2>/dev/null)
check_not "soul-only omits trajectories" bash -c "tar -tzf '$SOUL' | grep -q trajectories"

out=$(cd "$ROOT_B" && identity import "$SOUL" --name gamma 2>/dev/null)
GAMMA="$ROOT_B/.identities/gamma"
new_rt=$(grep '^root_trajectory=' "$GAMMA/info.txt" | cut -d= -f2-)
check "soul import re-roots"        test -n "$new_rt" -a "$new_rt" != "$ALPHA_RT"
check "new root traj exists"        test -f "$GAMMA/trajectories/${new_rt:0:8}-root/trajectory.jsonl"
check "memory travelled (soul)"     test -f "$GAMMA/memories/2026-01-01-00-00-00_fixture.md"
if grep -rq "$ALPHA_RT" "$GAMMA/thinkers"/*/subscriptions.jsonl 2>/dev/null; then
    bad "subscriptions re-pointed"
else
    ok "subscriptions re-pointed"
fi

# ---------------------------------------------------------------------------
# Multi-identity: export --all, import both into a fresh root
# ---------------------------------------------------------------------------

(cd "$ROOT_A" && identity new omega >/dev/null 2>&1)
ALL="$WORK/all.tgz"
(cd "$ROOT_A" && identity export --all -o "$ALL" 2>/dev/null)
check "multi manifest lists two" test "$(tar -xzOf "$ALL" manifest.json | jq -r '.identities | length')" = "2"

ROOT_C="$WORK/rootC"
mkdir -p "$ROOT_C"
out=$(cd "$ROOT_C" && identity import "$ALL" 2>/dev/null)
check "multi import prints both names" test "$(sort <<<"$out" | tr '\n' ' ')" = "alpha omega "
check "multi import installs alpha"    test -d "$ROOT_C/.identities/alpha"
check "multi import installs omega"    test -d "$ROOT_C/.identities/omega"

# --name is refused for multi-identity archives
if (cd "$WORK" && IDENTITY_DIR="$WORK/rootD/.identities" identity import "$ALL" --name solo >/dev/null 2>&1); then
    bad "--name refused for multi archive"
else
    ok "--name refused for multi archive"
fi

# ---------------------------------------------------------------------------
# Safety: archives with escaping paths are rejected before extraction
# ---------------------------------------------------------------------------

EVIL="$WORK/evil.tgz"
python3 - "$EVIL" <<'PYEOF'
import io, sys, tarfile
with tarfile.open(sys.argv[1], "w:gz") as tf:
    data = b"pwned\n"
    info = tarfile.TarInfo(name="../payload.txt")
    info.size = len(data)
    tf.addfile(info, io.BytesIO(data))
PYEOF
if (cd "$ROOT_B" && identity import "$EVIL" >/dev/null 2>&1); then
    bad "escaping archive rejected"
else
    ok "escaping archive rejected"
fi
check_not "escaping payload not written" test -e "$ROOT_B/payload.txt"

# Garbage input is a clean error
if identity import /etc/hosts >/dev/null 2>&1; then
    bad "non-archive rejected"
else
    ok "non-archive rejected"
fi

# ---------------------------------------------------------------------------

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
