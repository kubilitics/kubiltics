# Latest Ubuntu 22.04 LTS amd64 from Canonical.
# Choice: vanilla Ubuntu + ubuntu-drivers autoinstall on g5 instances.
# Rationale: simpler — single AMI lookup works for both CPU (t3) and GPU (g5) variants;
# the bootstrap script handles driver install conditionally. Tradeoff is one reboot on
# first boot for GPU instances (handled idempotently by user-data).
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

resource "aws_instance" "bench" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  key_name               = aws_key_pair.bench.key_name
  vpc_security_group_ids = [aws_security_group.bench.id]

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.volume_size_gb
    delete_on_termination = true
    encrypted             = true
    tags = {
      Name = "${var.name_prefix}-root"
    }
  }

  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    models = jsonencode(var.models)
  })

  # Re-render user_data does NOT recreate the instance (we want stop/start lifecycle).
  lifecycle {
    ignore_changes = [user_data, ami]
  }

  tags = {
    Name = var.name_prefix
  }
}

resource "aws_eip" "bench" {
  domain = "vpc"
  tags = {
    Name = "${var.name_prefix}-eip"
  }
}

resource "aws_eip_association" "bench" {
  instance_id   = aws_instance.bench.id
  allocation_id = aws_eip.bench.id
}
