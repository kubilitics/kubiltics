provider "aws" {
  region = var.region
  default_tags {
    tags = var.tags
  }
}

# Auto-detect caller's public IP when allowed_cidr is empty.
data "http" "my_ip" {
  count = var.allowed_cidr == "" ? 1 : 0
  url   = "https://checkip.amazonaws.com"
}

locals {
  detected_cidr = var.allowed_cidr != "" ? var.allowed_cidr : "${chomp(data.http.my_ip[0].response_body)}/32"
  is_gpu        = startswith(var.instance_type, "g") || startswith(var.instance_type, "p")
}
