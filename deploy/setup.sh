#!/usr/bin/env bash
set -euo pipefail

# deploy/setup.sh — provision a fresh Ubuntu VM to run shellm-web.
#
# Creates a dedicated `shellm` user, clones the repo to /opt/shellm/app,
# installs uv + bun for that user, prebuilds the viewer frontend, and
# installs + starts the systemd service (listening on 127.0.0.1:8080).
#
# Run as root (or with sudo) on Ubuntu 22.04/24.04:
#   sudo bash deploy/setup.sh
#
# Override defaults via env:
#   SHELLM_REPO=https://github.com/andyk/shellm.git
#   SHELLM_BRANCH=main
#   SHELLM_HOME=/opt/shellm
#
# After this script: put your (spend-capped!) API key in
# /opt/shellm/app/.env and set up the Cloudflare tunnel — see DEPLOY.md.

SHELLM_REPO="${SHELLM_REPO:-https://github.com/andyk/shellm.git}"
SHELLM_BRANCH="${SHELLM_BRANCH:-main}"
SHELLM_HOME="${SHELLM_HOME:-/opt/shellm}"
SHELLM_USER="shellm"
APP_DIR="$SHELLM_HOME/app"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ "$(id -u)" -eq 0 ]] || { echo "Run as root (sudo bash deploy/setup.sh)" >&2; exit 1; }

echo "==> Installing system packages"
apt-get update -qq
apt-get install -y -qq git jq curl unzip

echo "==> Creating service user $SHELLM_USER (home: $SHELLM_HOME)"
if ! id "$SHELLM_USER" >/dev/null 2>&1; then
    useradd --system --create-home --home-dir "$SHELLM_HOME" --shell /bin/bash "$SHELLM_USER"
fi

echo "==> Cloning $SHELLM_REPO ($SHELLM_BRANCH) to $APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
    sudo -u "$SHELLM_USER" git -C "$APP_DIR" fetch origin "$SHELLM_BRANCH"
    sudo -u "$SHELLM_USER" git -C "$APP_DIR" checkout "$SHELLM_BRANCH"
    sudo -u "$SHELLM_USER" git -C "$APP_DIR" pull --ff-only origin "$SHELLM_BRANCH"
else
    sudo -u "$SHELLM_USER" git clone --branch "$SHELLM_BRANCH" "$SHELLM_REPO" "$APP_DIR"
fi

echo "==> Installing uv and bun for $SHELLM_USER"
sudo -u "$SHELLM_USER" bash -c 'command -v ~/.local/bin/uv >/dev/null 2>&1 || curl -LsSf https://astral.sh/uv/install.sh | sh'
sudo -u "$SHELLM_USER" bash -c 'command -v ~/.bun/bin/bun >/dev/null 2>&1 || curl -fsSL https://bun.sh/install | bash'

echo "==> Prebuilding the viewer frontend"
sudo -u "$SHELLM_USER" bash -c "
    set -euo pipefail
    export PATH=\"\$HOME/.local/bin:\$HOME/.bun/bin:\$PATH\"
    cd '$APP_DIR/web/viewer'
    bun install --frozen-lockfile
    bun run build
    rm -rf '$APP_DIR/web/src/shellm_web/static'
    cp -R build/client '$APP_DIR/web/src/shellm_web/static'
    cd '$APP_DIR/web' && uv sync
"

echo "==> Seeding $APP_DIR/.env (add your API key here)"
if [[ ! -f "$APP_DIR/.env" ]]; then
    sudo -u "$SHELLM_USER" tee "$APP_DIR/.env" >/dev/null <<'ENV'
# Root env sourced by web-launched thinkers (and llm/shellm run from here).
# Use a DEDICATED, SPEND-CAPPED key: the agent executes arbitrary bash.
ANTHROPIC_API_KEY=
# SHELLM_MODEL=claude-opus-4-7
ENV
    chmod 600 "$APP_DIR/.env"
fi

echo "==> Installing systemd service"
sed "s|@SHELLM_HOME@|$SHELLM_HOME|g" "$SCRIPT_DIR/shellm-web.service" \
    > /etc/systemd/system/shellm-web.service
systemctl daemon-reload
systemctl enable --now shellm-web

echo
echo "Done. shellm-web is running on 127.0.0.1:8080 (not publicly reachable)."
echo
echo "Next steps:"
echo "  1. Add your spend-capped API key to $APP_DIR/.env"
echo "     then: systemctl restart shellm-web"
echo "  2. Set up the Cloudflare tunnel + Access policy — see deploy/DEPLOY.md"
