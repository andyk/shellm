# Deploying shellm-web behind Cloudflare Zero Trust

Goal: a private URL (e.g. `https://agents.example.com`) where allow-listed
people can watch, start/stop, and chat with identities. Architecture:

```
boss's browser ── Cloudflare Access (SSO / email OTP)
                        │
                  Cloudflare Tunnel (outbound-only from the VM)
                        │
                 127.0.0.1:8080  shellm-web (systemd)
                        │ spawns
                 dispatchers + thinkers (own sessions, survive restarts)
```

No inbound ports are ever opened on the VM. Auth lives entirely in
Cloudflare Access; the app itself stays auth-free.

## 0. Prerequisites

- A domain on Cloudflare and access to the Zero Trust dashboard (free tier
  covers this seat count).
- A small Ubuntu 22.04/24.04 VM (EC2 t4g.small / Lightsail / etc.).
  **Treat it as burnable** — the agent executes arbitrary bash on it. Run
  nothing else there.
- A **dedicated, spend-capped** Anthropic API key. A runaway thinker loop
  is a token furnace; the cap is your real safety net.

## 1. Provision the app

```bash
git clone https://github.com/andyk/shellm.git
sudo bash shellm/deploy/setup.sh          # or run from your checkout
```

The script creates a `shellm` system user, clones the repo to
`/opt/shellm/app`, installs uv + bun, prebuilds the viewer, and starts the
`shellm-web` systemd service on `127.0.0.1:8080`. Pass `SHELLM_REPO` /
`SHELLM_BRANCH` env vars to deploy a fork or feature branch.

Then add the API key:

```bash
sudo -u shellm nano /opt/shellm/app/.env    # set ANTHROPIC_API_KEY=...
sudo systemctl restart shellm-web
curl -s localhost:8080/api/health           # {"status":"ok"}
```

## 2. Cloudflare Tunnel

In the Zero Trust dashboard: **Networks → Tunnels → Create a tunnel**
(Cloudflared connector). Copy the install command it shows and run it on
the VM — it installs `cloudflared` and a systemd service in one step:

```bash
curl -L https://pkg.cloudflare.com/cloudflared-stable-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb              # (arm64 build for t4g instances)
sudo cloudflared service install <TOKEN-FROM-DASHBOARD>
```

In the tunnel's **Public Hostname** tab, add:

- Subdomain/domain: `agents.example.com`
- Service: `HTTP://localhost:8080`

Visit the hostname — you should see the viewer (still unprotected; next
step fixes that, so do it immediately).

## 3. Cloudflare Access policy

**Access → Applications → Add an application → Self-hosted**:

- Application domain: `agents.example.com`
- Policy: Action **Allow**, Include → **Emails** → your email + your
  boss's email. (Or an IdP group if you have Google/Okta wired up.)
- Session duration: e.g. 1 week.

That's the whole login system. Anyone not on the list gets Cloudflare's
block page; people on it authenticate once and land in the viewer.

## 4. Lock CORS to the public hostname

Uncomment in `/etc/systemd/system/shellm-web.service`:

```ini
Environment="SHELLM_WEB_ALLOWED_ORIGINS=https://agents.example.com"
```

then `sudo systemctl daemon-reload && sudo systemctl restart shellm-web`.
(Default is `*`, which is fine on a laptop but pointless exposure on a
deployment. Comma-separate multiple origins if you need them.)

## 5. Operating it

| Task | Command |
|---|---|
| Logs | `journalctl -u shellm-web -f` |
| Restart web server (agents keep running) | `sudo systemctl restart shellm-web` |
| Stop every agent process | `sudo -u shellm /opt/shellm/app/bin/shellm-killall` |
| Update to latest code | see below |
| View-only mode | uncomment `SHELLM_WEB_READONLY=1` in the unit |

**Updating:**

```bash
sudo -u shellm git -C /opt/shellm/app pull
sudo -u shellm rm -rf /opt/shellm/app/web/src/shellm_web/static  # forces frontend rebuild
sudo systemctl restart shellm-web
```

**Kill switches, in escalating order:** Kill All button in the UI →
`shellm-killall` on the box → `systemctl stop shellm-web` → stop the VM.

**Moving identities on/off the box:** every identity page has a Config →
Export button (and the home page has Export all / Import) producing a
portable `.shellm.tgz` — secrets (`.env`) and runtime state never leave the
machine. Use it to seed the deployment from a laptop identity, or as the
pre-demo backup. Two caveats:

- Importing an identity installs its thinkers — scripts that run when the
  identity is started. Only import archives you trust.
- Cloudflare's proxy caps request bodies at 100 MB on the free plan. For
  bigger archives, copy the file and use the CLI:

  ```bash
  scp big.shellm.tgz vm:/tmp/ && ssh vm \
      'sudo -u shellm env IDENTITY_DIR=/opt/shellm/app/.identities \
       /opt/shellm/app/bin/identity import /tmp/big.shellm.tgz'
  ```

  Uploads are also capped server-side via `SHELLM_WEB_MAX_IMPORT_MB`
  (default 512).

## Security notes

- The VM is the sandbox. Dedicated key with a spend cap, nothing else on
  the machine, snapshot before demos if you're nervous.
- `shellm-web` binds `127.0.0.1` and the tunnel is outbound-only, so the
  only path in is through Access. Don't "temporarily" bind `0.0.0.0`.
- Secrets: root key in `/opt/shellm/app/.env` (mode 600); per-identity
  overrides via the Config tab (stored in `<identity>/.env`).
- Optional: install Docker (`apt install docker.io`, add `shellm` to the
  `docker` group) so generated code runs in shellm's Docker sandbox
  instead of directly on the host.

## Quick demo alternative (no VM)

Run the tunnel from any machine you already have (dev box, spare Mac):
create the same dashboard tunnel + Access app, run
`cloudflared service install <TOKEN>` locally, point the public hostname
at `http://localhost:8080`, and start `./bin/shellm-web`. Same URL, same
login, zero infra — it just stops when your laptop sleeps.
