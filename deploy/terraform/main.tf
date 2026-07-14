terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    # Pinned to v4: the v5 provider reshapes the tunnel/Access resource
    # schemas. If you upgrade, expect to rewrite those resources.
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.52"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# Auth via CLOUDFLARE_API_TOKEN env var — see README for token permissions.
provider "cloudflare" {}

locals {
  hostname = "${var.subdomain}.${var.domain}"
}

# ---------------------------------------------------------------------------
# Cloudflare: tunnel, DNS, Access
# ---------------------------------------------------------------------------

resource "random_id" "tunnel_secret" {
  byte_length = 32
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "shellm" {
  account_id = var.cloudflare_account_id
  name       = "shellm-${var.subdomain}"
  secret     = random_id.tunnel_secret.b64_std
  config_src = "cloudflare"
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "shellm" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.shellm.id

  config {
    ingress_rule {
      hostname = local.hostname
      service  = "http://localhost:8080"
    }
    # Catch-all required by Cloudflare: anything else gets a 404
    ingress_rule {
      service = "http_status:404"
    }
  }
}

resource "cloudflare_record" "shellm" {
  zone_id = var.cloudflare_zone_id
  name    = var.subdomain
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.shellm.id}.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_zero_trust_access_application" "shellm" {
  zone_id          = var.cloudflare_zone_id
  name             = "shellm (${local.hostname})"
  domain           = local.hostname
  type             = "self_hosted"
  session_duration = var.access_session_duration
}

resource "cloudflare_zero_trust_access_policy" "allowlist" {
  application_id = cloudflare_zero_trust_access_application.shellm.id
  zone_id        = var.cloudflare_zone_id
  name           = "shellm email allowlist"
  precedence     = 1
  decision       = "allow"

  include {
    email = var.allowed_emails
  }
}

# ---------------------------------------------------------------------------
# AWS: one burnable VM, no inbound network path at all
# ---------------------------------------------------------------------------

data "aws_ami" "ubuntu_arm64" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd*/ubuntu-noble-24.04-arm64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Zero ingress rules — the tunnel dials out; admin access is via SSM.
resource "aws_security_group" "shellm" {
  name_prefix = "shellm-"
  description = "shellm agent box: egress only, no inbound"
  vpc_id      = data.aws_vpc.default.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_iam_role" "shellm" {
  name_prefix = "shellm-"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.shellm.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_caller_identity" "current" {}

# Read-only access to the single parameter holding the .env contents.
resource "aws_iam_role_policy" "env_parameter" {
  count = var.env_parameter != "" ? 1 : 0

  name_prefix = "shellm-env-"
  role        = aws_iam_role.shellm.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameter"]
      Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.env_parameter}"
    }]
  })
}

resource "aws_iam_instance_profile" "shellm" {
  name_prefix = "shellm-"
  role        = aws_iam_role.shellm.name
}

resource "aws_instance" "shellm" {
  ami                    = data.aws_ami.ubuntu_arm64.id
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.shellm.id]
  iam_instance_profile   = aws_iam_instance_profile.shellm.name

  root_block_device {
    volume_size = var.root_volume_gb
    volume_type = "gp3"
  }

  user_data = templatefile("${path.module}/user_data.sh.tpl", {
    tunnel_token      = cloudflare_zero_trust_tunnel_cloudflared.shellm.tunnel_token
    repo              = var.shellm_repo
    branch            = var.shellm_branch
    hostname          = local.hostname
    api_key       = var.anthropic_api_key
    env_parameter = var.env_parameter
    region        = var.aws_region
  })
  user_data_replace_on_change = true

  tags = {
    Name = "shellm-${var.subdomain}"
  }
}
