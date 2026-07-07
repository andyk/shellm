#!/usr/bin/env bash
set -euo pipefail

PREFIX="${PREFIX:-$HOME/.local/bin}"
SYMLINKS="${SYMLINKS:-0}"
TOOLS=(shellm shellm-docker shellm-docker-broker skills mem llm shellm-explore context traj identity thinkers chat focus)

while [[ $# -gt 0 ]]; do
    case "$1" in
        --symlinks) SYMLINKS=1; shift ;;
        --prefix)   PREFIX="${2:?--prefix requires a path}"; shift 2 ;;
        --help|-h)
            cat <<'EOF'
Usage: ./install.sh [options]

Installs shellm tools from bin/ to a directory on your PATH.

Options:
  --prefix DIR   Install directory (default: ~/.local/bin)
  --symlinks     Create symlinks instead of copies (edits take effect without reinstalling)
  -h, --help     Show this help

Environment variables:
  PREFIX         Same as --prefix
  SYMLINKS=1     Same as --symlinks

Examples:
  ./install.sh                          # copy to ~/.local/bin
  ./install.sh --symlinks               # symlink to ~/.local/bin
  ./install.sh --prefix /usr/local/bin  # copy to /usr/local/bin (may need sudo)
  PREFIX=~/bin SYMLINKS=1 ./install.sh  # symlink to ~/bin
EOF
            exit 0
            ;;
        *) echo "Unknown option: $1 (try --help)" >&2; exit 1 ;;
    esac
done

mkdir -p "$PREFIX"

for tool in "${TOOLS[@]}"; do
    if [[ "$SYMLINKS" -eq 1 ]]; then
        ln -sf "$(pwd)/bin/$tool" "$PREFIX/$tool"
        echo "Linked $tool → $PREFIX/$tool"
    else
        cp "bin/$tool" "$PREFIX/$tool"
        chmod +x "$PREFIX/$tool"
        echo "Installed $tool → $PREFIX/$tool"
    fi
done

# Build and install Rust TUI tools
if [[ -d "tui" ]]; then
    if command -v cargo &>/dev/null; then
        for tui_dir in tui/*/; do
            [[ -f "${tui_dir}Cargo.toml" ]] || continue
            name=$(basename "$tui_dir")
            printf 'Building %s...\n' "$name"
            (cd "$tui_dir" && cargo build --release --quiet) || {
                printf 'Warning: failed to build %s (skipping)\n' "$name" >&2
                continue
            }
            local_bin="${tui_dir}target/release/$name-tui"
            [[ -f "$local_bin" ]] || local_bin="${tui_dir}target/release/$name"
            if [[ -f "$local_bin" ]]; then
                cp "$local_bin" "$PREFIX/$(basename "$local_bin")"
                codesign --force --sign - "$PREFIX/$(basename "$local_bin")" 2>/dev/null || true
                echo "Installed $(basename "$local_bin") → $PREFIX/$(basename "$local_bin")"
            fi
        done
    else
        echo "Warning: cargo not found, skipping TUI tools" >&2
    fi
fi

# Install bundled skills to ~/.skills/core-skills
SKILLS_PREFIX="${HOME}/.skills/core-skills"
mkdir -p "$SKILLS_PREFIX"
for skill_dir in skills/*/; do
    [[ -f "${skill_dir}SKILL.md" ]] || continue
    name=$(basename "$skill_dir")
    if [[ "$SYMLINKS" -eq 1 ]]; then
        ln -sfn "$(pwd)/$skill_dir" "$SKILLS_PREFIX/$name"
    else
        rm -rf "$SKILLS_PREFIX/$name"
        cp -R "$skill_dir" "$SKILLS_PREFIX/$name"
    fi
done
echo "Installed core skills → $SKILLS_PREFIX"


# Install bundled thinker templates
THINKERS_PREFIX="${HOME}/.shellm-thinkers"
if [[ -d "thinkers" ]]; then
    mkdir -p "$THINKERS_PREFIX"
    if [[ "$SYMLINKS" -eq 1 ]]; then
        for td in thinkers/*/; do
            [[ -d "$td" ]] || continue
            ln -sfn "$(pwd)/$td" "$THINKERS_PREFIX/$(basename "$td")"
        done
        touch "$THINKERS_PREFIX/.use-symlinks"
    else
        for td in thinkers/*/; do
            [[ -d "$td" ]] || continue
            name=$(basename "$td")
            rm -rf "$THINKERS_PREFIX/$name"
            cp -R "$td" "$THINKERS_PREFIX/$name"
        done
        rm -f "$THINKERS_PREFIX/.use-symlinks"
    fi
    echo "Installed thinker templates → $THINKERS_PREFIX"
fi

case ":$PATH:" in
    *":$PREFIX:"*) ;;
    *)
        echo
        echo "Warning: $PREFIX is not on your PATH."
        echo "Add this line to your shell rc (~/.zshrc, ~/.bashrc, etc.):"
        echo "  export PATH=\"$PREFIX:\$PATH\""
        ;;
esac
