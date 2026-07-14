#!/usr/bin/env bash
# First-boot bootstrap (rendered by Terraform; runs as root via cloud-init).
set -euo pipefail
exec > /var/log/shellm-bootstrap.log 2>&1

echo "==> shellm bootstrap starting $(date -u)"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl

# --- cloudflared: install and connect the tunnel -------------------------
arch=$(dpkg --print-architecture)
curl -fsSL -o /tmp/cloudflared.deb \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$arch.deb"
dpkg -i /tmp/cloudflared.deb
cloudflared service install '${tunnel_token}'

# --- shellm: clone for setup.sh, which does the real provisioning --------
rm -rf /tmp/shellm-src
git clone --depth 1 --branch '${branch}' '${repo}' /tmp/shellm-src
SHELLM_REPO='${repo}' SHELLM_BRANCH='${branch}' bash /tmp/shellm-src/deploy/setup.sh

%{ if api_key != "" ~}
# --- API key from terraform.tfvars ----------------------------------------
sed -i 's|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=${api_key}|' /opt/shellm/app/.env
%{ endif ~}

# --- pin CORS to the public hostname --------------------------------------
mkdir -p /etc/systemd/system/shellm-web.service.d
cat > /etc/systemd/system/shellm-web.service.d/override.conf <<OVERRIDE
[Service]
Environment="SHELLM_WEB_ALLOWED_ORIGINS=https://${hostname}"
OVERRIDE

systemctl daemon-reload
systemctl restart shellm-web

echo "==> shellm bootstrap done $(date -u)"
