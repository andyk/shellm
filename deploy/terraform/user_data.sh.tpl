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

%{ if env_parameter != "" ~}
# --- .env from SSM Parameter Store (survives rebuilds) ---------------------
# The parameter holds the FULL root .env (all provider API keys). A missing
# parameter or CLI hiccup must not kill the bootstrap: keys can still be
# added by hand (see README), so warn and continue.
apt-get install -y -qq awscli || snap install aws-cli --classic || true
ENV_CONTENT=$(aws ssm get-parameter --name '${env_parameter}' \
    --with-decryption --region '${region}' \
    --query Parameter.Value --output text 2>/dev/null) || ENV_CONTENT=""
if [ -n "$ENV_CONTENT" ]; then
    printf '%s\n' "$ENV_CONTENT" > /opt/shellm/app/.env
    chown shellm:shellm /opt/shellm/app/.env
    chmod 600 /opt/shellm/app/.env
    unset ENV_CONTENT
    echo "==> .env installed from SSM parameter ${env_parameter}"
else
    echo "==> WARNING: no value at SSM parameter ${env_parameter}; add keys manually"
fi
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
