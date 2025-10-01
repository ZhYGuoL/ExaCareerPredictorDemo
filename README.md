# Career Paths - Cloudflare Workers Project

A Cloudflare Workers TypeScript project for career path prediction using edge computing with Exa API integration.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Exa API Key

Create a `.dev.vars` file in the project root (you can copy from `.env-template`):

```bash
cp .env-template .dev.vars
```

Then edit `.dev.vars` and add your actual API key:

```bash
EXA_KEY=your_actual_exa_api_key_here
```

Get your API key from [exa.ai](https://exa.ai/)

> **Note:** Wrangler uses `.dev.vars` for local development environment variables, not `.env`

### 3. Run Database Migrations

```bash
npm run migrate
```

## Development

### Start Dev Server

```bash
npm run dev
```

The server will start on `http://localhost:8787`

### Available Endpoints

- `GET /health` - Health check endpoint
- `POST /ingest/start` - Ingestion placeholder (returns `{ enqueued: 0 }`)
- `GET /debug/exa?q=<query>` - Test Exa API integration

### Example Usage

```bash
# Health check
curl http://localhost:8787/health

# Test Exa search
curl "http://localhost:8787/debug/exa?q=internship"
```

## Scripts

- `npm run dev` - Start local development server
- `npm run deploy` - Deploy to Cloudflare Workers
- `npm run typecheck` - Run TypeScript type checking
- `npm run migrate` - Apply D1 database migrations (local)
- `npm run sql -- "SQL_QUERY" -- --local` - Execute SQL queries on local database

## Database Schema

The project uses Cloudflare D1 with the following tables:

- `users` - User profiles (school, major, grad_year)
- `goals` - User career goals
- `sources` - Scraped data sources
- `candidates` - Career path candidates
- `events` - Career timeline events

## Project Structure

```
src/
├── index.ts        # Main worker entry point with routing
├── types.d.ts      # TypeScript type definitions for bindings
└── lib/
    └── exa.ts      # Exa API client wrapper
migrations/
└── 0001_init.sql   # Initial database schema
```

## Deployment

For production deployment:

1. Set up Cloudflare resources (D1, Vectorize, R2, etc.)
2. Set production secrets: `wrangler secret put EXA_KEY`
3. Update `wrangler.toml` with actual resource IDs
4. Deploy: `npm run deploy`

