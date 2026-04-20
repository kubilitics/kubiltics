# Kubilitics Ollama bench VM — Makefile
# Provision / lifecycle / introspect a g5.xlarge bench VM running Ollama.

THIS_MAKEFILE := $(abspath $(lastword $(MAKEFILE_LIST)))
TF_DIR        := $(dir $(THIS_MAKEFILE))
REGION        ?= us-east-1
SSH_OPTS      := -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10

TF       := terraform -chdir=$(TF_DIR)
KEY      := $(TF_DIR)bench-key.pem
TFVARS   := $(TF_DIR)terraform.tfvars

# Resolve at use-time (not parse-time) so help works pre-apply.
INSTANCE_ID = $$($(TF) output -raw instance_id 2>/dev/null)
PUBLIC_IP   = $$($(TF) output -raw public_ip   2>/dev/null)
OLLAMA_URL  = $$($(TF) output -raw ollama_url  2>/dev/null)

.DEFAULT_GOAL := help

.PHONY: help init plan up wait-ready stop start status endpoint pull models logs destroy

help: ## list available targets
	@echo "Kubilitics Ollama bench VM"
	@echo ""
	@echo "Targets:"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(THIS_MAKEFILE)
	@echo ""
	@echo "Typical flow: make up && make wait-ready && make endpoint"
	@echo "Cost saver  : make stop  (between sessions)  /  make start  (resume)"

init: ## terraform init
	$(TF) init

plan: ## terraform plan
	@if [ -f "$(TFVARS)" ]; then \
		$(TF) plan -var-file=$(TFVARS); \
	else \
		$(TF) plan; \
	fi

up: ## apply (provision VM + EIP + SG + key) and print endpoint
	@if [ -f "$(TFVARS)" ]; then \
		$(TF) apply -auto-approve -var-file=$(TFVARS); \
	else \
		$(TF) apply -auto-approve; \
	fi
	@echo ""
	@echo "==============================================="
	@echo "  Ollama URL : $$($(TF) output -raw ollama_url)"
	@echo "  SSH        : $$($(TF) output -raw ssh_command)"
	@echo "==============================================="
	@echo "Bootstrap (driver install + model pull) takes ~5-10 min."
	@echo "Run: make wait-ready"

wait-ready: ## SSH-poll until /var/lib/ollama-bench/ready exists
	@ip=$(PUBLIC_IP); \
	if [ -z "$$ip" ]; then echo "no public_ip — run make up first"; exit 1; fi; \
	echo "polling ubuntu@$$ip for /var/lib/ollama-bench/ready ..."; \
	start=$$(date +%s); \
	while true; do \
		if ssh -i $(KEY) $(SSH_OPTS) ubuntu@$$ip 'test -f /var/lib/ollama-bench/ready' 2>/dev/null; then \
			elapsed=$$(( $$(date +%s) - start )); \
			echo "READY after $${elapsed}s"; \
			exit 0; \
		fi; \
		echo "  not ready yet ($$(($$(date +%s) - start))s elapsed)..."; \
		sleep 15; \
	done

stop: ## stop the EC2 instance (saves ~$1/hr; EBS preserved)
	@id=$(INSTANCE_ID); \
	if [ -z "$$id" ]; then echo "no instance_id — nothing to stop"; exit 1; fi; \
	echo "stopping $$id ..."; \
	aws ec2 stop-instances --instance-ids $$id --region $(REGION) >/dev/null; \
	aws ec2 wait instance-stopped --instance-ids $$id --region $(REGION); \
	echo "STOPPED. EBS + EIP preserved."

start: ## start the EC2 instance (resume; EIP unchanged)
	@id=$(INSTANCE_ID); \
	if [ -z "$$id" ]; then echo "no instance_id — run make up first"; exit 1; fi; \
	echo "starting $$id ..."; \
	aws ec2 start-instances --instance-ids $$id --region $(REGION) >/dev/null; \
	aws ec2 wait instance-running --instance-ids $$id --region $(REGION); \
	echo "RUNNING. Ollama URL: $(OLLAMA_URL)"; \
	echo "give SSH ~30s to come up, then: make models"

status: ## show instance state + bootstrap log tail (if running)
	@id=$(INSTANCE_ID); ip=$(PUBLIC_IP); \
	if [ -z "$$id" ]; then echo "no instance_id — nothing provisioned"; exit 0; fi; \
	aws ec2 describe-instances --instance-ids $$id --region $(REGION) \
		--query 'Reservations[0].Instances[0].{State:State.Name,Type:InstanceType,Launch:LaunchTime,IP:PublicIpAddress}' \
		--output table; \
	state=$$(aws ec2 describe-instances --instance-ids $$id --region $(REGION) --query 'Reservations[0].Instances[0].State.Name' --output text); \
	if [ "$$state" = "running" ] && [ -n "$$ip" ]; then \
		echo ""; echo "--- bootstrap log tail ---"; \
		ssh -i $(KEY) $(SSH_OPTS) ubuntu@$$ip 'sudo tail -20 /var/log/ollama-bootstrap.log 2>/dev/null || echo "(no log yet)"'; \
	fi

endpoint: ## print the Ollama URL only
	@$(TF) output -raw ollama_url

pull: ## pull a model:  make pull MODEL=llama3.1:8b
	@if [ -z "$(MODEL)" ]; then echo "usage: make pull MODEL=<name>"; exit 1; fi; \
	ip=$(PUBLIC_IP); \
	ssh -i $(KEY) $(SSH_OPTS) ubuntu@$$ip "ollama pull $(MODEL)"

models: ## list models on the box (ollama list)
	@ip=$(PUBLIC_IP); \
	ssh -i $(KEY) $(SSH_OPTS) ubuntu@$$ip 'ollama list'

logs: ## tail bootstrap log (last 50 lines)
	@ip=$(PUBLIC_IP); \
	ssh -i $(KEY) $(SSH_OPTS) ubuntu@$$ip 'sudo tail -50 /var/log/ollama-bootstrap.log'

destroy: ## terraform destroy — wipes VM + EBS + pulled models
	$(TF) destroy -auto-approve
