.PHONY: help deploy build-lambdas deploy-stack update-api-key clean

# Default target
help:
	@echo "Available commands:"
	@echo "  make deploy          - Build all Lambda functions and deploy AWS stack"
	@echo "  make build-lambdas   - Build all Lambda functions"
	@echo "  make deploy-stack    - Deploy AWS CDK stack (requires Lambdas to be built)"
	@echo "  make update-api-key  - Update Riot API key in .env file"
	@echo "  make clean           - Clean Lambda build artifacts"

# Build all Lambda functions
build-lambdas:
	@echo "Building Lambda functions..."
	@cd ../lambda/api-handler && npm run build
	@cd ../lambda/fetch-matches && npm run build
	@cd ../lambda/process-match && npm run build
	@cd ../lambda/aggregate-stats && npm run build
	@echo "✓ All Lambda functions built successfully"

# Deploy AWS CDK stack with environment variables
deploy-stack:
	@echo "Deploying AWS CDK stack..."
	@if [ ! -f .env ]; then \
		echo "Error: .env file not found. Please create one with RIOT_API_KEY."; \
		exit 1; \
	fi
	@. ./.env && npm run deploy
	@echo "✓ AWS CDK stack deployed successfully"

# Build and deploy in one command
deploy: build-lambdas deploy-stack
	@echo "✓ Complete deployment finished!"

# Update Riot API key in .env file
update-api-key:
	@echo "Current API key (first 20 chars):"
	@grep RIOT_API_KEY .env | cut -d'=' -f2 | cut -d'"' -f2 | head -c 20 || echo "Not found"
	@echo ""
	@echo "Enter new Riot API key:"
	@read NEW_KEY; \
	if [ -z "$$NEW_KEY" ]; then \
		echo "Error: API key cannot be empty"; \
		exit 1; \
	fi; \
	if grep -q "^export RIOT_API_KEY=" .env; then \
		sed -i "s|^export RIOT_API_KEY=.*|export RIOT_API_KEY=\"$$NEW_KEY\"|" .env; \
	else \
		echo "" >> .env; \
		echo "export RIOT_API_KEY=\"$$NEW_KEY\"" >> .env; \
	fi; \
	echo "✓ Riot API key updated successfully"; \
	echo "Run 'make deploy' to deploy with the new key"

# Clean build artifacts
clean:
	@echo "Cleaning Lambda build artifacts..."
	@rm -rf ../lambda/api-handler/dist
	@rm -rf ../lambda/fetch-matches/dist
	@rm -rf ../lambda/process-match/dist
	@rm -rf ../lambda/aggregate-stats/dist
	@echo "✓ Build artifacts cleaned"
