# League of Legends Champion Recap (SvelteKit)

A SvelteKit application that displays a comprehensive year-end recap of your League of Legends stats, including match history, champion statistics, and performance metrics.

## Features

- **Player Search**: Search for any player by their Riot ID (Game Name + Tag Line)
- **Year Recap**: View all matches played in the current year
- **Overall Statistics**:
  - Total games played
  - Win rate percentage
  - Average KDA
  - Total kills, deaths, and assists
- **Most Played Champions**: See your top 5 most played champions with win rates
- **Match History**: Detailed view of all matches with:
  - Champion played
  - KDA stats
  - Damage dealt
  - CS (creep score)
  - Game duration
  - Items built
  - Win/Loss indicator

## Tech Stack

- **Framework**: SvelteKit 2.0+ with Svelte 5 (latest with runes)
- **Styling**: Tailwind CSS 4.0
- **Language**: TypeScript
- **API**: Riot Games API
- **Build Tool**: Vite

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
│   │   ├── types/
│   │   │   └── riot.ts          # TypeScript type definitions for Riot API
│   │   ├── data-dragon.ts       # Utility functions for Data Dragon assets
│   │   └── riot-api.ts          # Riot API integration functions
│   ├── routes/
│   │   ├── api/
│   │   │   └── player/
│   │   │       └── +server.ts   # API route for fetching player data
│   │   ├── +layout.svelte       # Root layout
│   │   └── +page.svelte         # Main page component
│   ├── app.css                  # Tailwind CSS imports
│   └── app.html                 # HTML template
├── .env.example                 # Environment variable template
├── package.json
├── svelte.config.js
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
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

## Deployment

This SvelteKit app can be deployed to various platforms:

- **Vercel**: `npm i -D @sveltejs/adapter-vercel`
- **Netlify**: `npm i -D @sveltejs/adapter-netlify`
- **Cloudflare Pages**: `npm i -D @sveltejs/adapter-cloudflare`
- **Node.js**: `npm i -D @sveltejs/adapter-node`
- **Static**: `npm i -D @sveltejs/adapter-static`

Update `svelte.config.js` with your chosen adapter. The project currently uses `@sveltejs/adapter-auto` which automatically selects the appropriate adapter based on your deployment platform.

## Environment Variables

- `RIOT_API_KEY`: Your Riot Games API key (required for server-side API calls)

## License

This project is for educational purposes. League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.

## Acknowledgments

- Data provided by Riot Games API
- Champion and item images from Data Dragon CDN
