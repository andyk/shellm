output "url" {
  description = "Where your boss goes"
  value       = "https://${local.hostname}"
}

output "instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.shellm.id
}

output "ssm_session_command" {
  description = "Shell on the box (no SSH needed)"
  value       = "aws ssm start-session --region ${var.aws_region} --target ${aws_instance.shellm.id}"
}

output "tunnel_id" {
  description = "Cloudflare tunnel ID"
  value       = cloudflare_zero_trust_tunnel_cloudflared.shellm.id
}

output "update_command" {
  description = "Update the box to the latest pushed branch: eval \"$(terraform output -raw update_command)\""
  value       = "aws ssm start-session --region ${var.aws_region} --target ${aws_instance.shellm.id} --document-name AWS-StartInteractiveCommand --parameters command='sudo bash /opt/shellm/app/deploy/update.sh'"
}
