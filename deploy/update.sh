#!/usr/bin/env bash
set -euo pipefail

# deploy/update.sh — pull the deploy branch, force a frontend rebuild,
# restart the web service. Running agents are untouched (dispatchers live
# in their own sessions).
#
# From your laptop:  eval "$(terraform output -raw update_command)"
# From an SSM session:  sudo bash /opt/shellm/app/deploy/update.sh

APP_DIR="${APP_DIR:-/opt/shellm/app}"

echo "==> Pulling latest"
sudo -u shellm git -C "$APP_DIR" pull --ff-only

echo "==> Forcing frontend rebuild on restart"
sudo -u shellm rm -rf "$APP_DIR/web/src/shellm_web/static"

echo "==> Restarting shellm-web (rebuild takes ~1-2 min)"
sudo systemctl restart shellm-web

for _ in $(seq 1 36); do
    if curl -fsS localhost:8080/api/health >/dev/null 2>&1; then
        echo "==> Healthy: $(curl -fsS localhost:8080/api/health)"
        echo "==> Now running: $(sudo -u shellm git -C "$APP_DIR" log -1 --oneline)"
        exit 0
    fi
    sleep 5
done

echo "==> ERROR: service not healthy after 3 minutes; check: journalctl -u shellm-web -n 50" >&2
exit 1
