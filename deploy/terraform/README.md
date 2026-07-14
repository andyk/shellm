# Terraform: shellm demo box (AWS + Cloudflare Zero Trust)

One `terraform apply` builds the whole stack from `deploy/DEPLOY.md`:

- **AWS**: a t4g.large Ubuntu 24.04 (arm64) instance with a 40 GB gp3 disk,
  a security group with **zero inbound rules**, and an SSM instance profile
  so you get a shell without SSH. First boot runs `deploy/setup.sh`
  (app under `/opt/shellm/app`, systemd service on `127.0.0.1:8080`),
  installs cloudflared with the tunnel token, and pins CORS to your
  hostname.
- **Cloudflare**: a remotely-configured tunnel with an ingress rule to
  `localhost:8080`, the proxied CNAME (`agents.example.com` →
  `<tunnel>.cfargotunnel.com`), and an Access application + email-allowlist
  policy. Auth lives entirely here; the app has none.

## Prerequisites

- Terraform >= 1.5
- AWS credentials in your environment (`AWS_PROFILE` / `aws configure`)
  with rights to manage EC2, IAM roles/instance profiles, and security
  groups.
- A Cloudflare API token in `CLOUDFLARE_API_TOKEN` with:
  - **Account → Cloudflare Tunnel → Edit**
  - **Account → Access: Apps and Policies → Edit**
  - **Account → Access: Organizations, Identity Providers, and Groups → Edit**
    (for the email-OTP login method)
  - **Zone → DNS → Edit** (scoped to your zone)
- Your Cloudflare **account ID** and the zone's **zone ID** (both on the
  dashboard).

## AWS permissions

Granularity is IAM policy on the user/role your CLI credentials belong to
(the CLI itself is just a passthrough). Two sane options:

- **Personal/sandbox account:** attach `AdministratorAccess` and move on.
- **Scoped:** attach `aws-policy.json` from this directory. It grants full
  EC2 (Terraform's describe/create/destroy churn makes narrower EC2
  painful), IAM confined to `shellm-*` roles/instance-profiles (including
  the sensitive `iam:PassRole`), and the SSM actions for shell sessions:

  ```bash
  aws iam create-policy --policy-name shellm-terraform \
      --policy-document file://aws-policy.json
  aws iam attach-user-policy --user-name <you> \
      --policy-arn arn:aws:iam::<account-id>:policy/shellm-terraform
  ```

For the SSM shell you'll also need the client plugin — see "Install the
tools" below. (It's first-party AWS, Apache-2.0, open source at
github.com/aws/session-manager-plugin; not a daemon — the CLI spawns it
per session.)

## What goes where

- **`terraform.tfvars`** — facts about the infrastructure (region, account
  and zone IDs, domain, emails, branch). Not secrets; edit when the infra
  should change. Gitignored anyway because the optional API key can live
  there.
- **Shell environment** — credentials for the tools: AWS creds live in
  `~/.aws` via `aws configure` (no export needed for the default profile),
  and `CLOUDFLARE_API_TOKEN` is the one real export, handled by direnv:
  `.envrc` (from `envrc.example`) loads it — via 1Password — when you cd
  into this directory and unloads it when you leave. direnv refuses to run
  an edited `.envrc` until you `direnv allow` it again. Prefer no plugin?
  `env.sh.example` is the manual `source` equivalent.

## Setup

### 0. Install the tools (macOS / brew)

```bash
brew install awscli                       # AWS CLI v2
brew tap hashicorp/tap
brew install hashicorp/tap/terraform      # brew core's terraform is frozen at 1.5.7
brew install --cask session-manager-plugin
brew install --cask 1password-cli         # the `op` command (optional but recommended)
brew install direnv
echo 'eval "$(direnv hook bash)"' >> ~/.bashrc && exec bash
```

`session-manager-plugin` is the client-side helper that gives
`aws ssm start-session` an interactive terminal — the box has no SSH and
no inbound ports, so SSM sessions (relayed outbound through AWS,
authorized by your IAM creds) are the only shell path. The AWS CLI finds
the plugin on PATH; you never invoke it directly.

For `op`: in the 1Password app enable Settings → Developer →
"Integrate with 1Password CLI", then store the Cloudflare token once:

```bash
op item create --category=apiCredential --title=cloudflare-tf \
    --vault=Private credential=<paste-token>
```

Verify everything:

```bash
aws sts get-caller-identity        # AWS creds work
terraform version                  # from the hashicorp tap
session-manager-plugin             # "...was installed successfully"
op vault list                      # 1Password CLI integrated + unlocked
```

### 1. Configure and apply

```bash
aws configure                                  # once; verify: aws sts get-caller-identity
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars   # fill in IDs, domain, emails
cp envrc.example .envrc                        # wire up the CF token (via op or paste)
direnv allow                                   # re-run after any .envrc edit
terraform init
terraform plan
terraform apply
```

First boot takes ~5 minutes (apt, uv/bun install, frontend build). Then
open the `url` output — you'll hit the Access login; anyone not on
`allowed_emails` gets blocked.

### The API keys (.env)

**Recommended: mirror your whole local `.env` via SSM Parameter Store
(zero-touch, survives rebuilds).** One SecureString parameter holds the
full root `.env` — ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENAI_ORG,
GEMINI_API_KEY, OPENROUTER_API_KEY, whatever else you keep there. Upload
from your laptop (never enters Terraform state):

```bash
aws ssm put-parameter --name /shellm/env --type SecureString \
    --value "$(cat ~/laude/repos/shellm/.env)" --overwrite \
    --region <your-region>
```

Every boot overwrites `/opt/shellm/app/.env` (mode 600) with the parameter
value; the instance role can read exactly that one parameter and nothing
else. Parameter name = the `env_parameter` variable (default
`/shellm/env`; `""` disables). Standard-tier parameters cap at 4 KB —
plenty for an env file.

- **Add/rotate keys:** edit your local `.env`, re-run the put-parameter
  command, then either replace the instance or re-fetch in place:

  ```bash
  # in an SSM session — pull the new .env without a rebuild
  sudo -u shellm bash -c 'aws ssm get-parameter --name /shellm/env \
      --with-decryption --region <your-region> \
      --query Parameter.Value --output text > /opt/shellm/app/.env'
  ```

  (No service restart needed — thinkers source `.env` at every start.)

If the parameter is missing at boot, the bootstrap warns and continues
with the seeded stub — fall back to the manual flow below.

**Fallback: install a key manually over SSM** after any (re)creation:

```bash
# 1. wait for first boot to finish (~5 min)
$(terraform output -raw ssm_session_command)
tail -f /var/log/shellm-bootstrap.log        # until "shellm bootstrap done"

# 2. install the key — read -rs keeps it out of history and `ps`
read -rs KEY                                  # paste sk-ant-..., press enter
sudo -u shellm sed -i "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$KEY|" /opt/shellm/app/.env
unset KEY

# 3. verify without printing it
sudo -u shellm grep -q '^ANTHROPIC_API_KEY=sk-' /opt/shellm/app/.env && echo key installed
```

No restart needed: thinkers source this `.env` every time they start, and
the web server itself never reads the key.

**Repeat steps 2–3 whenever the instance is recreated** — the key lives
only on the box, and `user_data_replace_on_change` means changing
repo/branch/emails recreates it. The tell if you forget: thinker logs loop
with `ANTHROPIC_API_KEY is not set`.

Alternative (zero-touch rebuilds): set `anthropic_api_key` in tfvars — the
key then also lives in Terraform state and the EC2 user-data attribute
(console-visible). Acceptable for a spend-capped key with local state.

Either way: use a **dedicated, spend-capped key**. The agent executes
arbitrary bash on this box; the cap is the real safety net.

## Day-2 operations

| Task | How |
|---|---|
| Shell on the box | `$(terraform output -raw ssm_session_command)` |
| Watch first-boot progress | in a session: `tail -f /var/log/shellm-bootstrap.log` |
| App logs | `journalctl -u shellm-web -f` |
| Update the app (after pushing!) | `eval "$(terraform output -raw update_command)"` — streams deploy/update.sh (pull, rebuild, restart, health check) |
| Add/remove viewers | edit `allowed_emails`, `terraform apply` |
| Panic | Kill All in the UI → `shellm-killall` on the box → stop the instance |
| Rebuild from scratch | `terraform destroy && terraform apply`, then re-install the API key (identities/trajectories are lost — copy them off first if they matter) |
| Pause billing | stop the instance in the console (~$3/mo for the disk); the tunnel reconnects on start |

## Troubleshooting

- **Bootstrap log ends with `deploy/setup.sh: No such file or directory`**:
  the box cloned a ref that predates the `deploy/` folder — almost always
  `shellm_branch` unset/commented in tfvars (default is `main`). Set the
  branch, push anything missing, and `terraform apply` (user_data changed,
  so the instance replaces itself).
- **Golden rule: the box runs what's *pushed* to `shellm_branch`, never
  your laptop's working tree.** Any local fix needs commit+push before the
  box can see it. Verify what the remote actually has with
  `git ls-tree -r origin/<branch> --name-only | grep <file>`.
- **Thinker logs loop with `ANTHROPIC_API_KEY is not set`**: the key isn't
  on the box (fresh or recreated instance) — redo "The API key" steps.

## Notes & caveats

- **State contains secrets** (tunnel token; the API key if you set it).
  State and `terraform.tfvars` are gitignored — keep it that way, or move
  state to a private S3 bucket once this outlives the demo.
- The Cloudflare provider is **pinned to v4** (`~> 4.52`). v5 renamed and
  reshaped the tunnel/Access resource schemas; upgrading means rewriting
  those ~5 resources, so don't bump the pin casually.
- The instance lives in your **default VPC** in a public subnet (it needs
  outbound internet for the tunnel and LLM APIs; nothing can dial in).
  If your account has no default VPC, add a small vpc module or create
  one first.
- `user_data_replace_on_change = true` means changing repo/branch/emails
  that feed user_data **recreates the instance** on apply — that's the
  burnable-box philosophy working as intended, but remember it wipes
  identities.
- SSM Session Manager needs no SG rules or public IP settings changes —
  the agent is preinstalled on Ubuntu AMIs and dials out, same as the
  tunnel.
