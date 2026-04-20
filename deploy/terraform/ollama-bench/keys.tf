resource "tls_private_key" "bench" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "aws_key_pair" "bench" {
  key_name   = "${var.name_prefix}-key"
  public_key = tls_private_key.bench.public_key_openssh
  tags = {
    Name = "${var.name_prefix}-key"
  }
}

resource "local_file" "private_key" {
  content         = tls_private_key.bench.private_key_pem
  filename        = "${path.module}/bench-key.pem"
  file_permission = "0600"
}
