#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# KOTG.AI — EC2 Development Instance Launcher
# Run this on your LOCAL machine (Mac/Linux) to provision the EC2 backend.
#
# Usage:
#   chmod +x scripts/launch-ec2.sh
#   ./scripts/launch-ec2.sh              # launch new instance
#   ./scripts/launch-ec2.sh --start      # start a stopped instance
#   ./scripts/launch-ec2.sh --status     # show current instance info
#   ./scripts/launch-ec2.sh --stop       # stop instance (save money)
#   ./scripts/launch-ec2.sh --terminate  # terminate instance permanently
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
KEY_NAME="kotg-key"
KEY_FILE="${HOME}/.ssh/kotg-key.pem"
SG_NAME="kotg-dev-sg"
INSTANCE_TAG="kotg-dev"
INSTANCE_TYPE="${KOTG_INSTANCE_TYPE:-m5.2xlarge}"   # override with env var for GPU
# GPU alternative: KOTG_INSTANCE_TYPE=g4dn.xlarge ./launch-ec2.sh
AMI_ID="ami-04680790a315cd58d"   # Ubuntu 22.04 LTS, us-east-1
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
VOLUME_SIZE=200
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
log_section() { echo -e "\n${BLUE}═══ $* ═══${NC}"; }

# ── Helpers ────────────────────────────────────────────────────────────────────
get_instance_id() {
    aws ec2 describe-instances \
        --filters "Name=tag:Name,Values=${INSTANCE_TAG}" \
                  "Name=instance-state-name,Values=running,stopped,pending" \
        --query 'Reservations[0].Instances[0].InstanceId' \
        --output text 2>/dev/null | grep -v 'None' || true
}

get_public_ip() {
    local iid="$1"
    aws ec2 describe-instances \
        --instance-ids "$iid" \
        --query 'Reservations[0].Instances[0].PublicIpAddress' \
        --output text 2>/dev/null | grep -v 'None' || true
}

get_instance_state() {
    local iid="$1"
    aws ec2 describe-instances \
        --instance-ids "$iid" \
        --query 'Reservations[0].Instances[0].State.Name' \
        --output text 2>/dev/null || true
}

wait_for_ssh() {
    local ip="$1"
    log_info "Waiting for SSH on ${ip}..."
    for i in $(seq 1 30); do
        if ssh -i "$KEY_FILE" -o ConnectTimeout=5 -o StrictHostKeyChecking=no \
               ubuntu@"$ip" "echo ok" &>/dev/null; then
            log_info "SSH ready"
            return 0
        fi
        sleep 5
        echo -n "."
    done
    log_error "SSH never became ready on $ip"
}

print_summary() {
    local ip="$1"
    local iid="$2"
    echo ""
    echo "  ┌──────────────────────────────────────────────────────────────────┐"
    echo "  │  KOTG.AI Development EC2                                         │"
    echo "  │                                                                  │"
    printf "  │  IP:  %-59s│\n" "${ip}"
    printf "  │  ID:  %-59s│\n" "${iid}"
    echo "  │                                                                  │"
    echo "  │  SSH:     ssh -i ~/.ssh/kotg-key.pem ubuntu@${ip}     │"
    echo "  │  Tunnel:  ./scripts/dev-tunnel.sh ${ip}               │"
    echo "  │                                                                  │"
    echo "  │  Ollama:  http://localhost:11434   (via tunnel)                  │"
    echo "  │  Qdrant:  http://localhost:6333    (via tunnel)                  │"
    echo "  └──────────────────────────────────────────────────────────────────┘"
    echo ""
    echo "  Add to ~/.ssh/config:"
    echo "  ─────────────────────────────────────────────────"
    echo "  Host kotg-dev"
    echo "    HostName ${ip}"
    echo "    User ubuntu"
    echo "    IdentityFile ${KEY_FILE}"
    echo "    ServerAliveInterval 60"
    echo "    ServerAliveCountMax 3"
    echo "    LocalForward 11434 127.0.0.1:11434"
    echo "    LocalForward 6333 127.0.0.1:6333"
    echo "    LocalForward 8080 127.0.0.1:8080"
    echo "  ─────────────────────────────────────────────────"
    echo ""
}

# ── Command dispatch ───────────────────────────────────────────────────────────
CMD="${1:-launch}"

case "$CMD" in

--status|status)
    log_section "Instance Status"
    INSTANCE_ID=$(get_instance_id)
    if [ -z "$INSTANCE_ID" ]; then
        log_warn "No kotg-dev instance found"
        exit 0
    fi
    STATE=$(get_instance_state "$INSTANCE_ID")
    IP=$(get_public_ip "$INSTANCE_ID")
    log_info "Instance: $INSTANCE_ID | State: $STATE | IP: ${IP:-none}"
    [ "$STATE" = "running" ] && print_summary "$IP" "$INSTANCE_ID"
    exit 0
    ;;

--stop|stop)
    log_section "Stopping Instance"
    INSTANCE_ID=$(get_instance_id)
    [ -z "$INSTANCE_ID" ] && log_error "No kotg-dev instance found"
    log_info "Stopping $INSTANCE_ID..."
    aws ec2 stop-instances --instance-ids "$INSTANCE_ID" --output text
    aws ec2 wait instance-stopped --instance-ids "$INSTANCE_ID"
    log_info "Instance stopped. EBS data is preserved."
    log_info "Restart with: ./scripts/launch-ec2.sh --start"
    exit 0
    ;;

--start|start)
    log_section "Starting Stopped Instance"
    INSTANCE_ID=$(get_instance_id)
    [ -z "$INSTANCE_ID" ] && log_error "No kotg-dev instance found. Use launch to create one."
    STATE=$(get_instance_state "$INSTANCE_ID")
    if [ "$STATE" = "running" ]; then
        IP=$(get_public_ip "$INSTANCE_ID")
        log_info "Instance already running at $IP"
        print_summary "$IP" "$INSTANCE_ID"
        exit 0
    fi
    log_info "Starting $INSTANCE_ID (state: $STATE)..."
    aws ec2 start-instances --instance-ids "$INSTANCE_ID" --output text
    aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
    IP=$(get_public_ip "$INSTANCE_ID")
    log_info "Instance running at $IP"
    print_summary "$IP" "$INSTANCE_ID"
    exit 0
    ;;

--terminate|terminate)
    log_section "Terminate Instance"
    INSTANCE_ID=$(get_instance_id)
    [ -z "$INSTANCE_ID" ] && log_error "No kotg-dev instance found"
    log_warn "This will PERMANENTLY destroy instance $INSTANCE_ID and all data!"
    read -rp "Type 'terminate' to confirm: " CONFIRM
    [ "$CONFIRM" != "terminate" ] && log_error "Aborted"
    aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" --output text
    log_info "Instance termination initiated"
    exit 0
    ;;

--launch|launch|"")
    log_section "Launching KOTG.AI EC2 Instance"
    ;;

*)
    echo "Usage: $0 [--launch|--start|--stop|--status|--terminate]"
    exit 1
    ;;
esac

# ── Launch flow ────────────────────────────────────────────────────────────────

# Check for existing instance
EXISTING=$(get_instance_id)
if [ -n "$EXISTING" ]; then
    STATE=$(get_instance_state "$EXISTING")
    IP=$(get_public_ip "$EXISTING")
    log_warn "Instance $EXISTING already exists (state: $STATE, ip: ${IP:-none})"
    log_warn "Use --start to start it, --status for info, or --terminate to replace"
    [ "$STATE" = "running" ] && print_summary "$IP" "$EXISTING"
    exit 0
fi

# Verify key file exists
if [ ! -f "$KEY_FILE" ]; then
    log_error "SSH key not found: $KEY_FILE\nCreate with: aws ec2 create-key-pair --key-name $KEY_NAME --query 'KeyMaterial' --output text > $KEY_FILE && chmod 400 $KEY_FILE"
fi

# Get security group
MY_IP=$(curl -sf https://checkip.amazonaws.com || curl -sf https://api.ipify.org)
log_info "Your IP: ${MY_IP}"

SG_ID=$(aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=${SG_NAME}" \
    --query 'SecurityGroups[0].GroupId' \
    --output text 2>/dev/null | grep -v 'None' || true)

if [ -z "$SG_ID" ]; then
    log_info "Creating security group ${SG_NAME}..."
    VPC_ID=$(aws ec2 describe-vpcs \
        --filters "Name=isDefault,Values=true" \
        --query 'Vpcs[0].VpcId' --output text)
    SG_ID=$(aws ec2 create-security-group \
        --group-name "$SG_NAME" \
        --description "KOTG.AI development security group" \
        --vpc-id "$VPC_ID" \
        --query 'GroupId' --output text)
    log_info "Created SG: $SG_ID"
    for PORT in 22 11434 6333 6334 8080; do
        aws ec2 authorize-security-group-ingress \
            --group-id "$SG_ID" \
            --protocol tcp --port "$PORT" \
            --cidr "${MY_IP}/32" 2>/dev/null || true
    done
fi
log_info "Security group: $SG_ID"

# Get subnet
SUBNET_ID=$(aws ec2 describe-subnets \
    --filters "Name=defaultForAz,Values=true" \
    --query 'Subnets[0].SubnetId' --output text)
log_info "Subnet: $SUBNET_ID"

# Launch instance
log_info "Launching ${INSTANCE_TYPE} with Ubuntu 22.04 (AMI: ${AMI_ID})..."
INSTANCE_ID=$(aws ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SG_ID" \
    --subnet-id "$SUBNET_ID" \
    --associate-public-ip-address \
    --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":${VOLUME_SIZE},\"VolumeType\":\"gp3\",\"Throughput\":250,\"DeleteOnTermination\":true}}]" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${INSTANCE_TAG}},{Key=Project,Value=KOTG.AI}]" \
    --query 'Instances[0].InstanceId' \
    --output text)
log_info "Instance ID: $INSTANCE_ID"

log_info "Waiting for instance to be running..."
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"

PUBLIC_IP=$(get_public_ip "$INSTANCE_ID")
log_info "Running at: $PUBLIC_IP"

wait_for_ssh "$PUBLIC_IP"

log_section "Running Bootstrap Script on EC2"
scp -i "$KEY_FILE" -o StrictHostKeyChecking=no \
    "${SCRIPT_DIR}/ec2-setup.sh" ubuntu@"${PUBLIC_IP}":~/ec2-setup.sh

ssh -i "$KEY_FILE" -o StrictHostKeyChecking=no ubuntu@"${PUBLIC_IP}" \
    "chmod +x ~/ec2-setup.sh && bash ~/ec2-setup.sh"

print_summary "$PUBLIC_IP" "$INSTANCE_ID"
log_info "Done! Start tunnel: ./scripts/dev-tunnel.sh ${PUBLIC_IP}"
