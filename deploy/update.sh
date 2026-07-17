#!/usr/bin/env bash
set -euo pipefail

# deploy/update.sh — pull the deploy branch, force a frontend rebuild,
# restart the web service. Running agents are untouched (dispatchers live
# in their own sessions).
#
# From your laptop:  eval "$(terraform output -raw update_command)"
# From an SSM session:  sudo bash /opt/shellm/app/deploy/update.sh

APP_DIR="${APP_DIR:-/opt/shellm/app}"
UNIT_DST="${UNIT_DST:-/etc/systemd/system/shellm-web.service}"

echo "==> Pulling latest"
sudo -u shellm git -C "$APP_DIR" pull --ff-only

# Re-sync the systemd unit from the repo so unit changes deploy like code.
# Box-local customization belongs in shellm-web.service.d/override.conf
# (drop-ins survive this); hand-edits to the main unit will be overwritten.
UNIT_SRC="$APP_DIR/deploy/shellm-web.service"
SHELLM_HOME="${SHELLM_HOME:-$(dirname "$APP_DIR")}"
if [[ -f "$UNIT_SRC" ]]; then
    rendered=$(sed "s|@SHELLM_HOME@|$SHELLM_HOME|g" "$UNIT_SRC")
    if ! printf '%s\n' "$rendered" | cmp -s - "$UNIT_DST" 2>/dev/null; then
        echo "==> Unit file changed — re-installing $UNIT_DST"
        printf '%s\n' "$rendered" | sudo tee "$UNIT_DST" >/dev/null
        sudo systemctl daemon-reload
    fi
fi

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
