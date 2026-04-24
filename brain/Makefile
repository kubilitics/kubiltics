.PHONY: build test clean run help proto

# Variables
BINARY_NAME=kubilitics-ai
BIN_DIR=bin
CMD_DIR=cmd/server
PROTO_DIR=api/proto
PROTO_OUT_DIR=api/proto/v1
VERSION=0.1.0

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: ## Build the kubilitics-ai binary
	@echo "Building $(BINARY_NAME)..."
	@mkdir -p $(BIN_DIR)
	@go build -o $(BIN_DIR)/$(BINARY_NAME) ./$(CMD_DIR)
	@echo "✓ Binary built: $(BIN_DIR)/$(BINARY_NAME)"

test: ## Run all tests
	@echo "Running tests..."
	@go test ./... -v -cover

test-coverage: ## Run tests with coverage report
	@echo "Running tests with coverage..."
	@go test ./... -v -coverprofile=coverage.out
	@go tool cover -html=coverage.out -o coverage.html
	@echo "✓ Coverage report generated: coverage.html"

run: build ## Build and run the server
	@echo "Starting $(BINARY_NAME)..."
	@./$(BIN_DIR)/$(BINARY_NAME)

clean: ## Clean build artifacts
	@echo "Cleaning..."
	@rm -rf $(BIN_DIR)
	@rm -f coverage.out coverage.html
	@echo "✓ Clean complete"

fmt: ## Format code
	@echo "Formatting code..."
	@go fmt ./...
	@echo "✓ Code formatted"

lint: ## Run linters
	@echo "Running linters..."
	@go vet ./...
	@echo "✓ Linting complete"

tidy: ## Tidy dependencies
	@echo "Tidying dependencies..."
	@go mod tidy
	@echo "✓ Dependencies tidied"

proto: ## Generate Go code from protocol buffers
	@echo "Generating protobuf code..."
	@mkdir -p $(PROTO_OUT_DIR)
	@protoc --go_out=$(PROTO_OUT_DIR) --go_opt=paths=source_relative \
		--go-grpc_out=$(PROTO_OUT_DIR) --go-grpc_opt=paths=source_relative \
		-I$(PROTO_DIR) $(PROTO_DIR)/*.proto
	@echo "✓ Protobuf code generated in $(PROTO_OUT_DIR)"

proto-check: ## Check if protoc is installed
	@which protoc > /dev/null || (echo "Error: protoc not found. Install with: brew install protobuf" && exit 1)
	@which protoc-gen-go > /dev/null || (echo "Error: protoc-gen-go not found. Install with: go install google.golang.org/protobuf/cmd/protoc-gen-go@latest" && exit 1)
	@which protoc-gen-go-grpc > /dev/null || (echo "Error: protoc-gen-go-grpc not found. Install with: go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest" && exit 1)
	@echo "✓ All protobuf tools installed"

.DEFAULT_GOAL := help
