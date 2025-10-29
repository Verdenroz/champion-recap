# F5-TTS Triton SageMaker Deployment

REGION = us-east-1
ACCOUNT_ID := $(shell aws sts get-caller-identity --query Account --output text)
ECR_URI = $(ACCOUNT_ID).dkr.ecr.$(REGION).amazonaws.com/f5tts-triton:latest

.PHONY: help push deploy clean

help:
	@echo "F5-TTS Triton Deployment"
	@echo ""
	@echo "Commands:"
	@echo "  make push    - Build and push Docker image to ECR"
	@echo "  make deploy  - Create ECR repo + push image"
	@echo "  make clean   - Remove local Docker images"

# Build and push to ECR
push:
	@docker buildx build --platform linux/amd64 --provenance=false --output type=docker -t f5tts-triton:latest .
	@aws ecr get-login-password --region $(REGION) | docker login --username AWS --password-stdin $(ACCOUNT_ID).dkr.ecr.$(REGION).amazonaws.com
	@docker tag f5tts-triton:latest $(ECR_URI)
	@docker push $(ECR_URI)
	@echo "✅ Pushed to ECR: $(ECR_URI)"

# Create ECR repo + push
deploy:
	@aws ecr create-repository --repository-name f5tts-triton --region $(REGION) 2>/dev/null || true
	@$(MAKE) push

# Cleanup
clean:
	@docker rmi f5tts-triton:latest 2>/dev/null || true
	@docker rmi $(ECR_URI) 2>/dev/null || true
