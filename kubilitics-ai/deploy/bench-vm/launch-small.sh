#!/usr/bin/env bash
# Launch the small-VM validator (t3.large, CPU, qwen2.5:3b).
# Waits for ollama to be reachable then prints the public DNS name.
# Tags the instance so terminate.sh can find it.
set -euo pipefail
cd "$(dirname "$0")"

KEY_NAME="${KEY_NAME:-kubilitics-ollama-bench-key}"
AMI_ID="${AMI_ID:-ami-053b0d53c279acc90}"   # Ubuntu 22.04 LTS (us-east-1). Override per region.
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.large}"
SG_ID="${SG_ID:?set SG_ID to a security group allowing 11434 from your laptop}"

iid=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --user-data "file://cloud-init.yaml" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Project,Value=kubilitics-bench},{Key=Size,Value=small},{Key=Name,Value=kubilitics-bench-small}]" \
  --query 'Instances[0].InstanceId' --output text)

echo "instance: $iid"
aws ec2 wait instance-running --instance-ids "$iid"
ip=$(aws ec2 describe-instances --instance-ids "$iid" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "public ip: $ip"

echo "waiting for ollama..."
for i in $(seq 1 60); do
  if curl -sf --max-time 3 "http://$ip:11434/api/tags" >/dev/null 2>&1; then
    echo "ollama up"
    break
  fi
  sleep 5
done
curl -sf "http://$ip:11434/api/tags" | jq
echo "INSTANCE_ID=$iid" > /tmp/bench-small.env
echo "OLLAMA_URL=http://$ip:11434" >> /tmp/bench-small.env
cat /tmp/bench-small.env
