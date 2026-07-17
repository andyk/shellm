# deploy/scripts/lib.sh — shared helpers for the deploy scripts. Source, don't run.
#
# These scripts wrap the terraform/aws incantations from
# deploy/terraform/README.md. They only need AWS credentials + terraform
# state — not CLOUDFLARE_API_TOKEN (that's only for terraform plan/apply),
# so they work outside direnv.

set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPTS_DIR/../.." && pwd)"
TF_DIR="$REPO_ROOT/deploy/terraform"

die()  { echo "error: $*" >&2; exit 1; }
info() { printf '==> %s\n' "$*"; }

tf() { terraform -chdir="$TF_DIR" "$@"; }

require_tools() {
    local tool
    for tool in "$@"; do
        command -v "$tool" >/dev/null 2>&1 \
            || die "'$tool' not found — see deploy/terraform/README.md 'Install the tools'"
    done
}

require_state() {
    [[ -f "$TF_DIR/terraform.tfstate" ]] \
        || die "no terraform state in deploy/terraform — provision first (deploy/terraform/README.md)"
}

require_aws() {
    aws sts get-caller-identity >/dev/null 2>&1 \
        || die "AWS credentials not working — aws configure / AWS_PROFILE / SSO login"
}

# Read a simple `key = "value"` line from terraform.tfvars.
tfvar() {
    local line=""
    line=$(grep -E "^[[:space:]]*$1[[:space:]]*=" "$TF_DIR/terraform.tfvars" 2>/dev/null | head -1) || true
    line="${line#*=}"
    line="${line%%#*}"
    line=$(printf '%s' "$line" | tr -d '"' | xargs)
    printf '%s' "${line:-${2:-}}"
}

region()      { tfvar aws_region; }
instance_id() { tf output -raw instance_id; }

instance_state() {
    aws ec2 describe-instances --region "$(region)" --instance-ids "$(instance_id)" \
        --query 'Reservations[0].Instances[0].State.Name' --output text
}

# Run one command on the box over SSM, streaming its output.
run_on_box() {
    require_tools session-manager-plugin jq
    # JSON form: the shorthand parser would split the command on commas.
    # The EOF grep drops the plugin's harmless complaint when the command
    # session closes.
    aws ssm start-session --region "$(region)" --target "$(instance_id)" \
        --document-name AWS-StartInteractiveCommand \
        --parameters "$(jq -n --arg c "$1" '{command: [$c]}')" \
        2> >(grep -v "Cannot perform start session: EOF" >&2 || true)
}
