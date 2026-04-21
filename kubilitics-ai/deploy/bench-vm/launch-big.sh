#!/usr/bin/env bash
# Launch the big-VM scale runner. g4dn.xlarge (T4 GPU, 4 vCPU, 16 GiB).
# Tags with Size=big so terminate.sh can find it.
set -euo pipefail
cd "$(dirname "$0")"

KEY_NAME="${KEY_NAME:-kubilitics-ollama-bench-key}"
AMI_ID="${AMI_ID:-ami-0e2c8caa4b6378d8c}"   # Deep Learning AMI (Ubuntu 22.04), has NVIDIA drivers pre-installed.
INSTANCE_TYPE="${INSTANCE_TYPE:-g5.2xlarge}"
SG_ID="${SG_ID:?set SG_ID to a security group allowing 11434 from your laptop}"
MODEL="${MODEL:-qwen2.5:32b-instruct}"
ROOT_DISK_GB="${ROOT_DISK_GB:-100}"
MAX_PULL_WAIT_SEC="${MAX_PULL_WAIT_SEC:-1200}"

# Customize cloud-init to pull the bigger model.
sed "s|qwen2.5:3b|$MODEL|" cloud-init.yaml > /tmp/cloud-init-big.yaml

iid=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --user-data "file:///tmp/cloud-init-big.yaml" \
  --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=$ROOT_DISK_GB}" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Project,Value=kubilitics-bench},{Key=Size,Value=big},{Key=Name,Value=kubilitics-bench-big}]" \
  --query 'Instances[0].InstanceId' --output text)

echo "instance: $iid"
aws ec2 wait instance-running --instance-ids "$iid"
ip=$(aws ec2 describe-instances --instance-ids "$iid" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "public ip: $ip"

echo "waiting for ollama + $MODEL pull (max ${MAX_PULL_WAIT_SEC}s)..."
for i in $(seq 1 $((MAX_PULL_WAIT_SEC / 10))); do
  if curl -sf --max-time 3 "http://$ip:11434/api/tags" 2>/dev/null | jq -e ".models[] | select(.name==\"$MODEL\")" >/dev/null; then
    echo "model ready"
    break
  fi
  sleep 10
done
curl -sf "http://$ip:11434/api/tags" | jq

echo "INSTANCE_ID=$iid" > /tmp/bench-big.env
echo "OLLAMA_URL=http://$ip:11434" >> /tmp/bench-big.env
echo "MODEL=$MODEL" >> /tmp/bench-big.env
cat /tmp/bench-big.env
