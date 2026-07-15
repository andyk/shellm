#!/usr/bin/env bash
# thinkers/_lib/common.sh — Shared helper library for thinkers
# Source this file from thinker step scripts.

# ---------------------------------------------------------------------------
# .env loading
# ---------------------------------------------------------------------------

# Fill in vars from a .env file WITHOUT overriding anything already set: the
# dispatcher's environment (web _ENV_WRAPPER, identity shell, an explicit
# THINK_MODEL=...) always wins, and earlier files beat later ones. Values are
# extracted by actually sourcing the file in a subshell so quoting behaves
# exactly like the loaders in bin/llm and bin/shellm.
_load_env_defaults() {
    local envfile="$1"
    [[ -f "$envfile" ]] || return 1
    local key val
    while IFS= read -r key; do
        [[ -n "$key" ]] || continue
        [[ -n "${!key+x}" ]] && continue
        val=$(set -a; . "$envfile" 2>/dev/null; printf '%s' "${!key}") || continue
        export "$key=$val"
    done < <(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}\([A-Za-z_][A-Za-z0-9_]*\)[[:space:]]*=.*/\2/p' "$envfile")
    return 0
}

# ---------------------------------------------------------------------------
# Environment checks
# ---------------------------------------------------------------------------

_require_env() {
    [[ -n "${IDENTITY_DIR:-}" ]] || { printf 'thinker: error: IDENTITY_DIR not set. Run: identity shell <name>\n' >&2; exit 1; }
    [[ -n "${TRAJ_DIR:-}" ]] || { printf 'thinker: error: TRAJ_DIR not set. Run: identity shell <name>\n' >&2; exit 1; }
    [[ -n "${TRAJ_ID:-}" ]] || { printf 'thinker: error: TRAJ_ID not set. Run: identity shell <name>\n' >&2; exit 1; }
    [[ -n "${MEM_DIR:-}" ]] || { printf 'thinker: error: MEM_DIR not set. Run: identity shell <name>\n' >&2; exit 1; }

    # Resolve identity name if not set
    if [[ -z "${IDENTITY_NAME:-}" ]]; then
        IDENTITY_NAME=$(grep '^name=' "$IDENTITY_DIR/info.txt" 2>/dev/null | cut -d= -f2-) || true
        [[ -z "$IDENTITY_NAME" ]] && IDENTITY_NAME=$(basename "$IDENTITY_DIR")
    fi

    # Defaults
    [[ -z "${SKILLS_DIR:-}" ]] && SKILLS_DIR="$IDENTITY_DIR/skills"
    [[ -z "${SKILLS_KERNEL_DIR:-}" ]] && SKILLS_KERNEL_DIR="$IDENTITY_DIR/kernel"

    # .env fallbacks — step scripts resolve THINK_MODEL/SHELLM_MODEL from
    # their environment BEFORE invoking llm/shellm (which load .env too
    # late to influence the -m flag), so the keys must be filled in here.
    _load_env_defaults "$IDENTITY_DIR/.env" || true
    _load_env_defaults ".env" || true
    _load_env_defaults "$HOME/.shellm/.env" || true

    mkdir -p "$MEM_DIR" "$SKILLS_DIR" "$SKILLS_KERNEL_DIR" "$TRAJ_DIR"
}

# ---------------------------------------------------------------------------
# System prompt assembly
# ---------------------------------------------------------------------------

# Build the common system prompt prefix shared by all thinkers.
# Calls `identity prompt` and `skills prompt` to assemble identity context.
_build_system_prompt() {
    local identity_text skills_text
    identity_text=$(identity prompt 2>/dev/null) || identity_text=""
    skills_text=$(skills prompt 2>/dev/null) || skills_text=""

    printf 'You are an unconscious thought process of an AI person named %s.\n' "$IDENTITY_NAME"
    printf '\nAbout %s:\n%s' "$IDENTITY_NAME" "$identity_text"
    if [[ -n "$skills_text" ]]; then
        printf '\n\n%s' "$skills_text"
    fi
}

# ---------------------------------------------------------------------------
# Goals
# ---------------------------------------------------------------------------

# Extract goals from identity's memories (type: goal/intention)
get_goals() {
    local mem_dir="${1:-$MEM_DIR}"
    [[ -d "$mem_dir" ]] || return 0
    local goals=""
    local f
    for f in "$mem_dir"/*.md; do
        [[ -f "$f" ]] || continue
        local ftype
        ftype=$(awk 'NR==1 && /^---$/{f=1; next} f && /^---$/{exit} f && /^type:/{sub(/^type:[[:space:]]*/, ""); print}' "$f")
        case "$ftype" in
            goal|intention)
                local body
                body=$(awk 'NR==1 && /^---$/{f=1; next} f && /^---$/{f=0; next} !f{print}' "$f" | sed '/./,$!d' | head -3)
                [[ -n "$body" ]] && goals="${goals}- ${body}
"
                ;;
        esac
    done
    if [[ -z "$goals" ]]; then
        printf '%s' "(no goals set)"
    else
        printf '%s' "$goals"
    fi
}

# ---------------------------------------------------------------------------
# Prompt loading
# ---------------------------------------------------------------------------

# Load a prompt template, replacing {{goals}} and {{identity_name}}
load_prompt() {
    local prompt_file="$1"
    local identity_name="$2"
    local goals="${3:-}"
    [[ -f "$prompt_file" ]] || return 1
    local content
    content=$(cat "$prompt_file")
    content=$(printf '%s' "$content" | sed "s/{{identity_name}}/$identity_name/g")
    local goals_file
    goals_file=$(mktemp)
    printf '%s' "$goals" > "$goals_file"
    if command -v perl >/dev/null 2>&1; then
        content=$(printf '%s' "$content" | perl -pe "
            BEGIN { open(F, '<', '$goals_file'); local \$/; \$g = <F>; close(F); chomp \$g; }
            s/\\{\\{goals\\}\\}/\$g/g;
        ")
    else
        local before after
        before="${content%%\{\{goals\}\}*}"
        after="${content#*\{\{goals\}\}}"
        if [[ "$before" != "$content" ]]; then
            content="${before}${goals}${after}"
        fi
    fi
    rm -f "$goals_file"
    printf '%s' "$content"
}

# ---------------------------------------------------------------------------
# Recent stream context
# ---------------------------------------------------------------------------

# Build a compact recent-stream context for thinker prompts: meaningful step
# types only, long content truncated. Excluding bulky machinery steps (prompt,
# shell-output, shellm-run, ...) keeps thinker prompts small AND prevents
# recursive inflation: a thinker's own prompt step must never be re-embedded
# in the context of its next run.
_recent_stream() {
    local n="${1:-${THINK_CONTEXT_TAIL:-20}}"
    # Tolerant parse (fromjson?): skip corrupt lines rather than dying —
    # concurrent appends have historically produced occasional bad lines.
    traj cat "${ROOT_TRAJ_ID:-$TRAJ_ID}" --raw 2>/dev/null \
        | jq -cR 'fromjson? // empty
            | select(.type == "thought" or .type == "action" or .type == "observation"
                     or .type == "message" or .type == "idle" or .type == "merge"
                     or .type == "final" or .type == "reasoning")
            | .content = ((.content // "") | tostring
                | if length > 1500 then .[0:1500] + "…[truncated]" else . end)' \
        2>/dev/null \
        | tail -n "$n"
}

# ---------------------------------------------------------------------------
# Skill variable collection
# ---------------------------------------------------------------------------

# Collect env vars declared by skills via SKILL.md frontmatter metadata
collect_skill_vars() {
    local identity_dir="$1"
    local -a var_names=()
    local -a dirs=("${SKILLS_KERNEL_DIR:-$identity_dir/kernel}" "$identity_dir/skills")
    local base skill_dir
    for base in "${dirs[@]}"; do
        [[ -d "$base" ]] || continue
        for skill_dir in "$base"/*/; do
            [[ -f "${skill_dir}SKILL.md" ]] || continue
            local frontmatter
            frontmatter=$(awk 'NR==1 && /^---$/{f=1; next} f && /^---$/{exit} f{print}' "${skill_dir}SKILL.md")
            [[ -z "$frontmatter" ]] && continue
            local env_val
            env_val=$(printf '%s\n' "$frontmatter" | awk '/^[[:space:]]+env:/{sub(/.*env:[[:space:]]*/, ""); print; exit}')
            [[ -z "$env_val" ]] && continue
            local v
            while IFS= read -r v; do
                [[ -n "$v" ]] && var_names+=("$v")
            done < <(printf '%s' "$env_val" | jq -r '.[]' 2>/dev/null)
        done
    done
    if [[ ${#var_names[@]} -gt 0 ]]; then
        printf '%s\n' "${var_names[@]}" | sort -u
    fi
}

# ---------------------------------------------------------------------------
# Path resolution
# ---------------------------------------------------------------------------

# Resolve a directory to an absolute path
_abs_path() {
    local dir="$1"
    (cd "$dir" 2>/dev/null && pwd) || printf '%s' "$dir"
}

# Build --var flags for skill-declared env vars
_build_skill_var_flags() {
    local identity_dir="$1"
    local -a flags=()
    while IFS= read -r vname; do
        [[ -z "$vname" ]] && continue
        local vval="${!vname:-}"
        [[ -n "$vval" ]] && flags+=(--var "$vname=$vval")
    done < <(collect_skill_vars "$identity_dir")
    if [[ ${#flags[@]} -gt 0 ]]; then
        printf '%s\n' "${flags[@]}"
    fi
}

# Build common shellm flags: --env, --workdir, --var, --bin.
# Honors SHELLM_THINKER_ENV to override the env (e.g. =local to skip Docker).
_build_shellm_flags() {
    local identity_dir="$1"
    local run_dir="${2:-$identity_dir/workdir}"
    local abs_mem_dir abs_skills_dir abs_kernel_dir abs_traj_dir

    abs_mem_dir=$(_abs_path "$MEM_DIR")
    abs_skills_dir=$(_abs_path "$SKILLS_DIR")
    abs_kernel_dir=$(_abs_path "$SKILLS_KERNEL_DIR")
    abs_traj_dir=$(_abs_path "$TRAJ_DIR")

    printf '%s\n' "--env" "${SHELLM_THINKER_ENV:-$IDENTITY_NAME}"
    printf '%s\n' "--workdir" "$run_dir"
    # IDENTITY_NAME must reach the generated code's env: `chat reply` dies
    # without it (observed: actor unable to reply, model flailing into
    # `chat send` variants). Non-directory --var values are plain env vars.
    printf '%s\n' "--var" "IDENTITY_NAME=$IDENTITY_NAME"
    printf '%s\n' "--var" "MEM_DIR=$abs_mem_dir"
    printf '%s\n' "--var" "SKILLS_DIR=$abs_skills_dir"
    printf '%s\n' "--var" "SKILLS_KERNEL_DIR=$abs_kernel_dir"
    printf '%s\n' "--var" "TRAJ_DIR=$abs_traj_dir"
    printf '%s\n' "--var" "TRAJ_ID=$TRAJ_ID"

    # Skill-declared vars
    while IFS= read -r vname; do
        [[ -z "$vname" ]] && continue
        local vval="${!vname:-}"
        [[ -n "$vval" ]] && printf '%s\n' "--var" "$vname=$vval"
    done < <(collect_skill_vars "$identity_dir")

    # Standard binaries
    local cmd
    for cmd in mem traj skills context llm shellm chat; do
        local path
        path=$(command -v "$cmd" 2>/dev/null) || continue
        printf '%s\n' "--bin" "$path"
    done
}

# Resolve the directory of the thinker calling this library
_thinker_dir() {
    local script="$1"
    cd "$(dirname "$(realpath "$script")")" && pwd
}
