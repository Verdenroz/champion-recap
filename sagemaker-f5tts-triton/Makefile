# Makefile for F5-TTS Triton SageMaker Multi-Model Endpoint with TensorRT-LLM

# Configuration
REGION ?= us-east-1
REPO_NAME = f5tts-triton
IMAGE_TAG = latest
CONTAINER_NAME = f5tts-triton-test
F5TTS_MODEL ?= F5TTS_Base
VOICE_BUCKET ?= champion-recap-voices
MODEL_BUCKET ?= champion-recap-models

# Derived variables
ACCOUNT_ID := $(shell aws sts get-caller-identity --query Account --output text)
ECR_URI = $(ACCOUNT_ID).dkr.ecr.$(REGION).amazonaws.com/$(REPO_NAME):$(IMAGE_TAG)

.PHONY: help build build-engines test run stop clean clean-old ecr-login ecr-create push deploy validate-aws

help:
	@echo "F5-TTS Triton TensorRT-LLM SageMaker Multi-Model Endpoint"
	@echo ""
	@echo "Available targets:"
	@echo "  build          - Build Docker image with TensorRT-LLM"
	@echo "  build-engines  - Build TensorRT engines in running container"
	@echo "  test           - Run local tests (build + start container + verify)"
	@echo "  run            - Start container locally for testing"
	@echo "  stop           - Stop and remove local test container"
	@echo "  clean          - Remove local Docker image and containers"
	@echo ""
	@echo "  ecr-create     - Create ECR repository (if not exists)"
	@echo "  ecr-login      - Login to ECR"
	@echo "  push           - Build, tag, and push image to ECR"
	@echo "  deploy         - Full deployment (create repo, build, push)"
	@echo ""
	@echo "Configuration:"
	@echo "  REGION         - AWS region (default: us-east-1)"
	@echo "  F5TTS_MODEL    - Model variant (default: F5TTS_Base)"
	@echo "  VOICE_BUCKET   - S3 bucket for champion voices (default: champion-recap-voices)"
	@echo "  ACCOUNT_ID     - AWS account ID (auto-detected: $(ACCOUNT_ID))"
	@echo "  ECR_URI        - Full ECR image URI: $(ECR_URI)"

build:
	@echo "🏗️  Building Docker image with TensorRT-LLM..."
	docker build -f Dockerfile.new -t $(REPO_NAME):$(IMAGE_TAG) .
	@echo "✅ Build complete: $(REPO_NAME):$(IMAGE_TAG)"
	@echo ""
	@echo "⚠️  Note: TensorRT engines will be built on first container start"
	@echo "This may take 30-45 minutes. Monitor with: make logs"

build-engines:
	@echo "🔧 Building TensorRT engines in running container..."
	@docker exec $(CONTAINER_NAME) /workspace/build_engines.sh
	@echo "✅ TensorRT engines built successfully"

run: stop
	@echo "🚀 Starting Triton container with TensorRT-LLM..."
	docker run -d \
		--name $(CONTAINER_NAME) \
		--gpus all \
		-p 8000:8000 \
		-p 8001:8001 \
		-p 8002:8002 \
		-e F5TTS_MODEL=$(F5TTS_MODEL) \
		-e VOICE_BUCKET=$(VOICE_BUCKET) \
		-e MODEL_BUCKET=$(MODEL_BUCKET) \
		$(REPO_NAME):$(IMAGE_TAG)
	@echo "⏳ Container started. TensorRT engine building in progress..."
	@echo "This may take 30-45 minutes on first start."
	@echo ""
	@echo "Monitor progress with: make logs"
	@echo "Check health when ready: make health"

stop:
	@echo "🛑 Stopping container..."
	@docker stop $(CONTAINER_NAME) 2>/dev/null || true
	@docker rm $(CONTAINER_NAME) 2>/dev/null || true
	@echo "✅ Container stopped"

health:
	@echo "🏥 Checking Triton health..."
	@curl -f http://localhost:8000/v2/health/ready && echo "✅ Triton is ready" || echo "❌ Triton not ready"

models:
	@echo "📋 Listing loaded models..."
	@curl -s http://localhost:8000/v2/models | python3 -m json.tool || echo "❌ Failed to get models"

logs:
	@docker logs -f $(CONTAINER_NAME)

clean: stop
	@echo "🧹 Cleaning up Docker images..."
	@docker rmi $(REPO_NAME):$(IMAGE_TAG) 2>/dev/null || true
	@docker rmi $(ECR_URI) 2>/dev/null || true
	@echo "✅ Cleanup complete"

ecr-create:
	@echo "📦 Creating ECR repository..."
	@aws ecr create-repository \
		--repository-name $(REPO_NAME) \
		--region $(REGION) \
		--image-scanning-configuration scanOnPush=true \
		2>/dev/null || echo "Repository already exists"
	@echo "✅ ECR repository ready"

ecr-login:
	@echo "🔐 Logging in to ECR..."
	@aws ecr get-login-password --region $(REGION) | \
		docker login --username AWS --password-stdin $(ACCOUNT_ID).dkr.ecr.$(REGION).amazonaws.com
	@echo "✅ Logged in to ECR"

push: build ecr-login
	@echo "🏷️  Tagging image for ECR..."
	docker tag $(REPO_NAME):$(IMAGE_TAG) $(ECR_URI)
	@echo "📤 Pushing to ECR..."
	docker push $(ECR_URI)
	@echo ""
	@echo "======================================"
	@echo "✅ Image pushed successfully"
	@echo "======================================"
	@echo "ECR URI: $(ECR_URI)"
	@echo ""

deploy: ecr-create push
	@echo "✅ Deployment complete"

test: build run
	@echo "🧪 Running local tests..."
	@sleep 15
	@echo ""
	@echo "Testing Triton health endpoint..."
	@curl -f http://localhost:8000/v2/health/ready && echo "✅ Health check passed" || (echo "❌ Health check failed" && exit 1)
	@echo ""
	@echo "Testing model listing..."
	@curl -s http://localhost:8000/v2/models | python3 -m json.tool
	@echo ""
	@echo "✅ Local tests complete"
	@echo "Container is running. Use 'make stop' to stop it."

# AWS account validation
validate-aws:
	@if [ -z "$(ACCOUNT_ID)" ]; then \
		echo "❌ Failed to get AWS account ID. Please configure AWS CLI."; \
		exit 1; \
	fi
	@echo "✅ AWS configured (Account: $(ACCOUNT_ID), Region: $(REGION))"
