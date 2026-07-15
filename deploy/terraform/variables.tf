variable "aws_region" {
  description = "AWS region for the VM"
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type (Graviton/arm64 assumed by the AMI filter)"
  type        = string
  default     = "t4g.large"
}

variable "root_volume_gb" {
  description = "Root EBS volume size (gp3)"
  type        = number
  default     = 40
}

variable "shellm_repo" {
  description = "Git repo to deploy"
  type        = string
  default     = "https://github.com/andyk/shellm.git"
}

variable "shellm_branch" {
  description = "Branch to deploy"
  type        = string
  default     = "main"
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID (Zero Trust dashboard URL or account home)"
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Zone ID of the domain (overview page of the zone)"
  type        = string
}

variable "domain" {
  description = "The zone's domain, e.g. example.com"
  type        = string
}

variable "subdomain" {
  description = "Subdomain for the viewer, e.g. agents -> agents.example.com"
  type        = string
  default     = "agents"
}

variable "allowed_emails" {
  description = "Emails allowed through Cloudflare Access"
  type        = list(string)
}

variable "access_session_duration" {
  description = "How long an Access login lasts"
  type        = string
  default     = "168h"
}

variable "env_parameter" {
  description = <<-EOT
    Name of an SSM SecureString parameter holding the FULL contents of the
    box's root .env (ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENAI_ORG,
    GEMINI_API_KEY, OPENROUTER_API_KEY, ...). Create/update it out-of-band
    from your local shellm/.env (never enters Terraform state):
      aws ssm put-parameter --name /shellm/env --type SecureString \
          --value "$(cat ~/laude/repos/shellm/.env)" --overwrite \
          --region <region>
    First boot writes it to /opt/shellm/app/.env, so instance rebuilds
    self-heal. NOTE: user-data runs once per instance — after changing the
    parameter, either force a rebuild:
      terraform apply -replace=aws_instance.shellm
    or update the running box in place over SSM:
      aws ssm start-session --target <instance-id> --region <region>
      # then on the box: re-run the fetch and restart shellm-web
    Set to "" to disable.
  EOT
  type        = string
  default     = "/shellm/env"
}
