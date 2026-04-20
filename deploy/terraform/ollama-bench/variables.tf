variable "region" {
  description = "AWS region to deploy the bench VM into."
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type. Default t3.large (2 vCPU / 8 GiB RAM, CPU-only) — fits a 3B Q4 model with headroom and costs ~$0.083/hr. Bump to t3.xlarge (16 GiB) for 7B models, or g5.xlarge for GPU."
  type        = string
  default     = "t3.large"
}

variable "models" {
  description = "List of Ollama models to pre-pull on first boot. Pulled in order via `ollama pull`. Default qwen2.5:3b (~2GB, snappy on CPU, strong technical reasoning)."
  type        = list(string)
  default     = ["qwen2.5:3b"]
}

variable "volume_size_gb" {
  description = "Root EBS volume size in GiB. 30 fits ~3 small (3B) models plus system; bump to 60 if pulling 7B+ models too."
  type        = number
  default     = 30
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
