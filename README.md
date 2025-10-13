# Champion Recap

**Your Season, Your Story** - A personalized League of Legends year-end recap powered by AWS AI services.

Built for the [Rift Rewind Hackathon](https://rift-rewind.devpost.com/) by Riot Games and AWS.

## Overview

Champion Recap analyzes your entire League of Legends match history to generate personalized insights about your gameplay:

- **Top 3 Champions**: Your most played champions
- **Favorite Champions**: Teammate champions (by role) you win most with
- **Nemesis Champions**: Enemy laners you struggle against most
- **Hated Champions**: Enemy champions (by role) you lose to most

### AWS-Powered Processing

This application leverages serverless AWS infrastructure to process match data at scale:
- **Lambda**: Parallel match processing with SQS queue
- **DynamoDB**: Player profiles and statistics storage
- **S3**: Raw match data caching
- **SQS**: FIFO queue for ordered match processing
- **API Gateway**: REST API with Server-Sent Events (SSE) streaming

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    User / Frontend (SvelteKit)                   │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS (SSE Streaming)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      AWS API Gateway                             │
│              (REST API with CORS enabled)                        │
└────────────────────────────┬────────────────────────────────────┘
                             │ Invoke
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│               Lambda: API Handler (512 MB, 30s)                  │
│         Routes requests, returns PUUID, polls for progress       │
└─────┬──────────────────────┬────────────────────────────────────┘
      │ Sync Invoke          │ Query Status
      ▼                      ▼
┌──────────────┐     ┌─────────────────┐
│   Lambda:    │     │   DynamoDB:     │
│Fetch Matches │     │ Player Stats    │
│(1GB, 15min)  │     └─────────────────┘
└──────┬───────┘              │
       │                      │ Track Progress:
       │ 1. Get PUUID         │ - status: PROCESSING/COMPLETE
       │ 2. Get Match IDs     │ - totalMatches: 109
       │ 3. Check S3 Cache    │ - processedMatches: 97
       │ 4. Queue Uncached    │ - cachedMatches: 0
       ▼                      │
┌──────────────┐              │
│  Riot API    │              │
└──────┬───────┘              │
       │ Queue                │
       ▼                      │
┌─────────────────────────────────────────────────────────────────┐
│              Amazon SQS FIFO Queue                               │
│        (Ordered processing per player, batch size: 5)            │
└────────────────────────────┬────────────────────────────────────┘
                             │ Trigger (batch: 5)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│         Lambda: Process Match (512 MB, 2min)                     │
│   Fetch match from Riot, save to S3, increment counter           │
│   Trigger aggregation every 20 matches                           │
└─────┬──────────────────────┬────────────────────────────────────┘
      │ Store                │ Atomic Increment
      ▼                      ▼
┌──────────────┐     ┌─────────────────┐
│  Amazon S3   │     │   DynamoDB:     │
│ Match Cache  │     │ Player Table    │
│matches/{puuid}/    └─────────────────┘
│  {matchId}   │              │ Trigger (every 20 matches)
└──────────────┘              ▼
                     ┌─────────────────────────────┐
                     │Lambda: Aggregate Stats      │
                     │   (2GB, 5min)               │
                     │Compute Champion Statistics  │
                     └──────────┬──────────────────┘
                                │ Save Results
                                ▼
                     ┌─────────────────────────────┐
                     │  DynamoDB: Champion Stats   │
                     │ (Top 3, Favorites, Nemesis) │
                     │        TTL: 7 days          │
                     └─────────────────────────────┘
```

### Progressive Data Flow

1. **User submits** gameName + tagLine → SSE endpoint
2. **API Handler** calls fetch-matches Lambda **synchronously** → gets PUUID immediately
3. **Frontend receives** PUUID and starts polling for progress
4. **fetch-matches** queues uncached matches to SQS (FIFO, ordered per player)
5. **process-match** Lambda triggered by SQS, processes 5 matches at once
6. **Every 20 matches** → aggregate-stats runs → Champion stats updated in DynamoDB
7. **Frontend polls** `/player/recap` every 2-10 seconds
8. **Progressive updates**: Frontend displays partial stats as they're computed
9. **When complete**: Status marked COMPLETE, final stats sent to frontend

### Key Features

- ✅ **Real-time progress**: Server-Sent Events stream updates to client
- ✅ **Progressive loading**: Stats appear as matches process (every ~20 matches)
- ✅ **Smart caching**: S3 stores matches at `matches/{puuid}/{matchId}.json`
- ✅ **FIFO ordering**: SQS ensures matches process in order per player
- ✅ **Rate limiting**: Retry logic handles Riot API 429 responses
- ✅ **Atomic counters**: DynamoDB tracks exact progress without race conditions
- ✅ **Serverless scale**: Handles 100,000+ concurrent users
- ✅ **Cost efficient**: ~$0.006 per player processed

## Tech Stack

### Frontend
- **Framework**: SvelteKit 2.0+ with Svelte 5 (runes)
- **Styling**: Tailwind CSS 4.0
- **Language**: TypeScript
- **Build Tool**: Vite

### Backend (AWS Serverless)
- **Compute**: AWS Lambda (Node.js 20)
- **Infrastructure**: AWS CDK (TypeScript)
- **Database**: DynamoDB
- **Storage**: S3
- **API**: API Gateway
- **Data Source**: Riot Games API

## Getting Started

### Prerequisites

- Node.js 18+ or compatible package manager (npm, pnpm, yarn, bun)
- Riot Games API Key (get one from [Riot Developer Portal](https://developer.riotgames.com/))

### Installation

1. Clone the repository and navigate to the project directory:

```bash
cd champion-recap
```

2. Install dependencies:

```bash
npm install
# or
pnpm install
# or
yarn
# or
bun install
```

3. Create a `.env` file in the root directory and add your Riot API key:

```bash
RIOT_API_KEY=your_riot_api_key_here
```

You can copy the `.env.example` file:

```bash
cp .env.example .env
```

### Development

Start the development server:

```bash
npm run dev
# or
npm run dev -- --open
```

The application will be available at `http://localhost:5173`

### Building for Production

To create a production build:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Project Structure

```
champion-recap/
├── src/
│   ├── lib/
│   │   ├── champion-stats.ts    # Core statistics logic (NEW)
│   │   ├── riot-api.ts          # Riot API client with caching
│   │   ├── types/riot.ts        # TypeScript types for Riot API
│   │   └── db/cache.ts          # SQLite cache for local dev
│   └── routes/
│       ├── +layout.svelte       # App layout
│       └── api/player/+server.ts # API endpoint (local dev)
│
├── lambda/                       # AWS Lambda functions (NEW)
│   ├── fetch-matches/           # Fetches matches from Riot API
│   ├── aggregate-stats/         # Computes champion statistics
│   └── api-handler/             # API Gateway handler
│
├── aws-cdk/                      # AWS infrastructure (NEW)
│   ├── lib/champion-recap-stack.ts  # CDK stack definition
│   └── bin/app.ts                   # CDK entry point
│
├── AWS_DEPLOYMENT.md             # AWS deployment guide (NEW)
└── README.md                     # This file
```

## API Routes

### GET `/api/player`

Fetches player data including account info, summoner details, and match history for the current year.

**Query Parameters:**
- `gameName` (required): The player's game name
- `tagLine` (required): The player's tag line (e.g., NA1)
- `platform` (optional): Platform/server (default: 'na1')
- `region` (optional): Regional routing value (default: 'americas')

**Response:**
```json
{
  "account": { ... },
  "summoner": { ... },
  "matches": [ ... ],
  "totalMatches": 100,
  "year": 2025
}
```

## Key Features of Svelte 5 Implementation

This project uses the latest Svelte 5 features:

- **Runes**: `$state`, `$derived` for reactive state management
- **Modern Syntax**: No more `let`, `$:` reactive statements - uses runes instead
- **Type Safety**: Full TypeScript support throughout
- **Enhanced img tag**: Native `<img>` tags instead of Next.js Image component

## AWS Deployment

For production use, deploy the serverless backend to AWS:

```bash
cd aws-cdk
npm install
export RIOT_API_KEY="your_key"
cdk deploy
```

See [AWS_DEPLOYMENT.md](./AWS_DEPLOYMENT.md) for complete instructions including:
- Infrastructure setup
- Lambda function deployment
- DynamoDB configuration
- Scaling to 100,000+ users
- Cost optimization
- Monitoring and debugging

## Champion Recap Logic

### How Statistics Are Calculated

**Top 3 Champions**: Count games per champion, sort descending

**Favorite Champions**: For each role, find teammate champion with highest win rate (min 3 games)

**Nemesis Champions**: Count losses against lane opponents, sort by total losses (min 3 games)

**Hated Champions**: For each role, find enemy champion you lost to most (min 3 games)

See `src/lib/champion-stats.ts` for implementation details.

## Environment Variables

- `RIOT_API_KEY`: Your Riot Games API key (required for server-side API calls)

## License

This project is for educational purposes. League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.

## Acknowledgments

- Data provided by Riot Games API
- Champion and item images from Data Dragon CDN
