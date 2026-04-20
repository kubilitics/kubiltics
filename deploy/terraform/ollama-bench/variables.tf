variable "region" {
  description = "AWS region to deploy the bench VM into."
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type. Default g5.xlarge (NVIDIA A10G 24GB). Use t3.xlarge for CPU-only fallback or g5.2xlarge for more headroom."
  type        = string
  default     = "g5.xlarge"
}

variable "models" {
  description = "List of Ollama models to pre-pull on first boot. Pulled in order via `ollama pull`."
  type        = list(string)
  default     = ["qwen2.5-coder:7b"]
}

variable "volume_size_gb" {
  description = "Root EBS volume size in GiB. Sized for Ollama install + multiple 5-15GB models + system."
  type        = number
  default     = 60
}

variable "allowed_cidr" {
  description = "CIDR allowed to reach Ollama (11434) and SSH (22). Empty -> auto-detect current public IP via checkip.amazonaws.com and lock to /32."
  type        = string
  default     = ""
}

variable "name_prefix" {
  description = "Prefix used for AWS resource names and tags."
  type        = string
  default     = "kubilitics-ollama-bench"
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default = {
    Project   = "kubilitics"
    Component = "ollama-bench"
    ManagedBy = "terraform"
  }
}
