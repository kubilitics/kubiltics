output "instance_id" {
  description = "EC2 instance ID."
  value       = aws_instance.bench.id
}

output "public_ip" {
  description = "Stable Elastic IP attached to the bench VM."
  value       = aws_eip.bench.public_ip
}

output "ollama_url" {
  description = "Ollama API base URL."
  value       = "http://${aws_eip.bench.public_ip}:11434"
}

output "ssh_command" {
  description = "Ready-to-run SSH command."
  value       = "ssh -i bench-key.pem ubuntu@${aws_eip.bench.public_ip}"
}

output "endpoint_summary" {
  description = "How to point the kubilitics-ai bench at this VM."
  value       = <<-EOT
    Ollama bench VM ready.

      Endpoint : http://${aws_eip.bench.public_ip}:11434
      SSH      : ssh -i bench-key.pem ubuntu@${aws_eip.bench.public_ip}

    Point kubilitics-ai at it:
      export KUBILITICS_AI_LLM_OLLAMA_BASE_URL=http://${aws_eip.bench.public_ip}:11434
      export KUBILITICS_AI_LLM_PROVIDER=ollama

    Lifecycle (cost saver):
      make stop    # ~$1/hr -> ~$3/mo (EBS only)
      make start   # resume; same EIP, model preserved on EBS

    Bootstrap (model pull) takes 5-10 min on first boot:
      make wait-ready
      make logs
  EOT
}
