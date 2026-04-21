#!/usr/bin/env bash
# Preflight for the bench VM launch. Fails fast with the exact next
# command if anything blocks the run (quota, SG, AMI, credentials).
#
# Exit codes:
#   0 ok
#   1 generic failure
#   2 quota insufficient
#   3 security group missing / misconfigured
#   4 AMI unavailable
#   5 AWS credentials missing
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
INSTANCE_TYPE="${INSTANCE_TYPE:-g5.2xlarge}"
REQUIRED_VCPU=8
SG_ID="${SG_ID:-sg-09b612ed6a1404d11}"
AMI_ID="${AMI_ID:-ami-0e2c8caa4b6378d8c}"

fail() { echo "PREFLIGHT FAIL: $1" >&2; exit "${2:-1}"; }

echo "=== AWS credentials ==="
aws sts get-caller-identity --query 'Arn' --output text >/dev/null 2>&1 \
  || fail "AWS CLI not authenticated — run \`aws configure\` or set AWS_PROFILE" 5
echo "ok: $(aws sts get-caller-identity --query 'Arn' --output text)"

echo "=== region ==="
echo "using: $REGION"

echo "=== vCPU quota for g-family On-Demand ==="
current=$(aws service-quotas get-service-quota \
  --region "$REGION" \
  --service-code ec2 \
  --quota-code L-DB2E81BA \
  --query 'Quota.Value' --output text 2>/dev/null || echo 0)
current_int="${current%.*}"
if [ "$current_int" -lt "$REQUIRED_VCPU" ]; then
  fail "g-family On-Demand vCPU quota is $current_int, need $REQUIRED_VCPU for $INSTANCE_TYPE. Request via:
  aws service-quotas request-service-quota-increase --region $REGION --service-code ec2 --quota-code L-DB2E81BA --desired-value $REQUIRED_VCPU" 2
fi
echo "ok: quota = $current_int vCPU (need $REQUIRED_VCPU)"

echo "=== security group $SG_ID ==="
aws ec2 describe-security-groups --region "$REGION" --group-ids "$SG_ID" \
  --query 'SecurityGroups[0].GroupName' --output text >/dev/null 2>&1 \
  || fail "security group $SG_ID not found in region $REGION. Create one or override SG_ID." 3
has_11434=$(aws ec2 describe-security-groups --region "$REGION" --group-ids "$SG_ID" \
  --query 'SecurityGroups[0].IpPermissions[?FromPort==`11434`] | [0].FromPort' --output text)
if [ "$has_11434" != "11434" ]; then
  myip=$(curl -sf https://api.ipify.org)
  fail "security group $SG_ID does not allow 11434 (Ollama). Open it with:
  aws ec2 authorize-security-group-ingress --region $REGION --group-id $SG_ID --protocol tcp --port 11434 --cidr $myip/32" 3
fi
echo "ok: 11434 open on $SG_ID"

echo "=== AMI $AMI_ID ==="
aws ec2 describe-images --region "$REGION" --image-ids "$AMI_ID" \
  --query 'Images[0].State' --output text 2>/dev/null | grep -q available \
  || fail "AMI $AMI_ID not available in $REGION. Update AMI_ID to a current Deep Learning AMI." 4
echo "ok: AMI $AMI_ID available"

echo "=== disk plan ==="
echo "root: 100 GB (qwen2.5:72b-instruct ~46 GB + OS + headroom)"

echo
echo "ALL PREFLIGHT CHECKS PASSED"
