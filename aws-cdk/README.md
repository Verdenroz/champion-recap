# AWS CDK Infrastructure for Champion Recap

This directory contains the AWS CDK infrastructure code for the Champion Recap application.

## Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js 20.x or higher
- AWS CDK CLI installed (`npm install -g aws-cdk`)

## Environment Setup

1. Create a `.env` file in this directory:

```bash
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION="us-east-1"

# Riot API Key
export RIOT_API_KEY="your-riot-api-key-here"
```

## Quick Start

### Full Deployment (Recommended)

Build all Lambda functions and deploy the stack in one command:

```bash
make deploy
```

This will:
1. Build all 4 Lambda functions (api-handler, fetch-matches, process-match, aggregate-stats)
2. Deploy the AWS CDK stack with the updated code
3. Apply environment variables from `.env`

### Update Riot API Key

The Riot API key expires every 24 hours. To update it quickly:

```bash
make update-api-key
```

This will:
1. Show you the first 20 characters of your current key
2. Prompt you to enter a new key
3. Update the `.env` file
4. Remind you to run `make deploy` to apply the change

After updating the key, deploy the changes:

```bash
make deploy
```

## Available Make Commands

| Command | Description |
|---------|-------------|
| `make help` | Show all available commands |
| `make deploy` | Build all Lambda functions and deploy AWS stack |
| `make build-lambdas` | Build all Lambda functions only |
| `make deploy-stack` | Deploy AWS CDK stack (requires Lambdas to be built) |
| `make update-api-key` | Update Riot API key in .env file |
| `make clean` | Clean Lambda build artifacts |

## Manual Deployment

If you prefer manual control:

1. **Build Lambda functions:**
   ```bash
   cd ../lambda/api-handler && npm run build
   cd ../lambda/fetch-matches && npm run build
   cd ../lambda/process-match && npm run build
   cd ../lambda/aggregate-stats && npm run build
   ```

2. **Deploy CDK stack:**
   ```bash
   source .env
   npm run deploy
   ```

## Architecture

The CDK stack creates:

- **DynamoDB Tables:**
  - `ChampionRecap-Players` - Player processing status
  - `ChampionRecap-Stats` - Aggregated champion statistics

- **S3 Bucket:**
  - `champion-recap-matches-{account-id}` - Cached match data

- **SQS Queues:**
  - `champion-recap-match-processing.fifo` - Match processing queue
  - `champion-recap-processing-dlq.fifo` - Dead letter queue

- **Lambda Functions:**
  - `champion-recap-api-handler` - API Gateway handler
  - `champion-recap-fetch-matches` - Fetches match IDs and queues processing
  - `champion-recap-process-match` - Processes individual matches from SQS
  - `champion-recap-aggregate-stats` - Aggregates statistics for recap

- **API Gateway:**
  - REST API with CORS enabled
  - Routes: `/player`, `/player/recap`, `/player/status`

## Outputs

After deployment, the stack outputs:

- **ApiUrl** - The API Gateway URL for your backend
- **MatchDataBucketName** - S3 bucket name for match data
- **PlayerTableName** - DynamoDB table for player data
- **ChampionStatsTableName** - DynamoDB table for statistics

## Daily Workflow

Since Riot API keys expire every 24 hours:

```bash
# 1. Get new API key from Riot Developer Portal
# 2. Update the key
make update-api-key

# 3. Deploy with new key
make deploy
```

## Troubleshooting

### Lambda Functions Not Updating

If your Lambda functions aren't updating after deployment:

```bash
# Clean old builds
make clean

# Rebuild and deploy
make deploy
```

### Environment Variables Not Applied

Make sure to source the `.env` file before deploying:

```bash
source .env
npm run deploy
```

Or use the Makefile which does this automatically:

```bash
make deploy-stack
```

### Check Lambda Logs

```bash
# API Handler logs
aws logs tail /aws/lambda/champion-recap-api-handler --follow

# Fetch Matches logs
aws logs tail /aws/lambda/champion-recap-fetch-matches --follow

# Process Match logs
aws logs tail /aws/lambda/champion-recap-process-match --follow

# Aggregate Stats logs
aws logs tail /aws/lambda/champion-recap-aggregate-stats --follow
```

## Cleanup

To destroy all resources:

```bash
npm run destroy
```

**Warning:** This will delete all DynamoDB tables, S3 buckets, and Lambda functions. Make sure to backup any important data first.
