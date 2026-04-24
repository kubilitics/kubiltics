#!/usr/bin/env bash
# Terminate every instance tagged Project=kubilitics-bench.
# Useful as a panic button and the happy-path cleanup.
set -euo pipefail

ids=$(aws ec2 describe-instances \
  --filters "Name=tag:Project,Values=kubilitics-bench" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[].InstanceId' --output text)

if [ -z "$ids" ]; then
  echo "no kubilitics-bench instances to terminate"
  exit 0
fi
echo "terminating: $ids"
aws ec2 terminate-instances --instance-ids $ids --query 'TerminatingInstances[*].[InstanceId,CurrentState.Name]' --output table
