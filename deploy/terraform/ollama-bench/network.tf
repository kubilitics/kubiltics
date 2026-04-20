data "aws_vpc" "default" {
  default = true
}

resource "aws_security_group" "bench" {
  name        = "${var.name_prefix}-sg"
  description = "Allow SSH + Ollama API from caller IP only"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH from caller"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [local.detected_cidr]
  }

  ingress {
    description = "Ollama API from caller"
    from_port   = 11434
    to_port     = 11434
    protocol    = "tcp"
    cidr_blocks = [local.detected_cidr]
  }

  egress {
    description = "All egress"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.name_prefix}-sg"
  }
}
