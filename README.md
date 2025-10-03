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
- `POST /ingest/start` - Start career path ingestion (generates queries, searches Exa, enqueues URLs)
- `POST /rank/final` - **End-to-end ranking pipeline** (Vectorize shortlist → Soft-DTW re-rank → top-N results)
- `POST /rerank` - Re-rank candidate sequences using Soft-DTW (Durable Object)
- `GET /debug/exa?q=<query>` - Test Exa API integration
- `GET /debug/r2?key=<path>` - Retrieve stored R2 object for debugging

### Example Usage

```bash
# Health check
curl http://localhost:8787/health

# Start ingestion with user profile and goal
curl -X POST http://localhost:8787/ingest/start \
  -H "content-type: application/json" \
  -d '{
    "profile": {
      "school": "Stanford",
      "major": "CS"
    },
    "goal": {
      "target_company": "Google",
      "target_year": "junior"
    }
  }'

# Test Exa search directly
curl "http://localhost:8787/debug/exa?q=internship"

# Re-rank candidates using Soft-DTW (loads vectors from D1)
curl -X POST http://localhost:8787/rerank \
  -H "content-type: application/json" \
  -d '{
    "userEvents": [
      {"role": "Software Engineering Intern", "org": "Google", "acad_year": "junior"}
    ],
    "candidateIds": ["<candidateId1>", "<candidateId2>"],
    "gamma": 0.1
  }'

# Example with real candidate IDs:
curl -X POST http://localhost:8787/rerank \
  -H "content-type: application/json" \
  -d '{
    "userEvents": [
      {"role": "Research Assistant", "org": "Stanford", "acad_year": "sophomore"},
      {"role": "Software Engineering Intern", "org": "Google", "acad_year": "junior"}
    ],
    "candidateIds": [
      "193902b8eeba41edf0c1863c32edcaddf8af1bde",
      "3be553d6da662848f23314ec4da04c4e5b5465d2"
    ]
  }'

# End-to-end ranking (shortlist from Vectorize → re-rank with Soft-DTW → return top-N)
curl -X POST http://localhost:8787/rank/final \
  -H "content-type: application/json" \
  -d '{
    "profile": {"school": "MIT", "major": "CS", "grad_year": 2026},
    "goal": {"target_company": "Meta", "target_year": "junior"},
    "userEvents": [
      {"role": "Software Engineer Intern", "org": "Google", "acad_year": "sophomore"}
    ],
    "topK": 50,
    "topN": 5,
    "gamma": 0.1
  }'
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
- `event_vectors` - Cached event embeddings (768-dim vectors stored as BLOBs) for fast re-ranking

## Project Structure

```
src/
├── index.ts          # Main worker entry point with routing + queue consumer
├── ingest-worker.ts  # Queue consumer for processing ingested URLs
├── reranker.ts       # Durable Object for Soft-DTW re-ranking
├── types.d.ts        # TypeScript type definitions for bindings
└── lib/
    ├── exa.ts        # Exa API client wrapper
    ├── extract.ts    # Event extraction from raw text
    ├── store.ts      # D1 database operations (upsert/insert)
    └── embed.ts      # Workers AI embedding generation + Vectorize storage
migrations/
└── 0001_init.sql     # Initial database schema
```

## Architecture

The project uses a queue-based architecture with multiple stages:

1. **API Worker** (`src/index.ts`) - Receives ingestion requests, searches Exa API, enqueues URLs
2. **Queue Consumer** (`src/ingest-worker.ts`) - Processes URLs from the queue:
   - Fetches page contents via Exa API
   - Stores raw JSON in R2 (using SHA-1 hash of URL as key)
   - Extracts career events using keyword matching (stub implementation)
   - Upserts candidate record in D1 (using URL hash as ID)
   - Inserts extracted events into D1 with proper relationships
   - Generates embeddings using Workers AI (@cf/baai/bge-base-en-v1.5, 768 dimensions)
   - Stores embeddings in **both** Vectorize (for semantic search) and D1 `event_vectors` table (for fast re-ranking)
3. **D1 Database** - Stores normalized career path data
4. **R2 Storage** - Stores raw page contents for processing
5. **Cloudflare Queue** - Decouples ingestion from processing for scalability
6. **Vectorize** - Vector database for semantic similarity search across career events
7. **Workers AI** - Generates text embeddings for semantic understanding
8. **Durable Object (ReRanker)** - Stateful re-ranking service using Soft-DTW algorithm for sequence similarity
   - Loads candidate event sequences from D1 `event_vectors` table
   - Embeds user's career events on-the-fly using Workers AI
   - Computes Soft-DTW distance between sequences (considers order and timing)
   - Returns similarity scores in (0,1] range (higher = better match)
   - **Caching:** In-memory cache with TTL (10 min) and LRU eviction (200 entry cap)
     - Cache key: SHA-1 hash of `{userEvents, candidateIds, gamma}`
     - Repeated requests with identical inputs return cached results instantly
     - Response includes `cached: boolean` field for debugging

### Verifying the Pipeline

To verify the complete pipeline is working:

```bash
# Start dev server with Vectorize production binding
npx wrangler dev --experimental-vectorize-bind-to-prod

# Trigger an ingestion (in another terminal)
curl -X POST http://localhost:8787/ingest/start \
  -H "content-type: application/json" \
  -d '{"profile":{"school":"MIT","major":"CS"},"goal":{"target_company":"Apple","target_year":"sophomore"}}'

# Check Vectorize index stats
npx wrangler vectorize info career-events

# Query the D1 database to see stored data
npm run sql -- "SELECT COUNT(*) FROM events" -- --local
npm run sql -- "SELECT COUNT(*) FROM candidates" -- --local
npm run sql -- "SELECT COUNT(*) FROM event_vectors" -- --local

# Inspect a sample event vector
npm run sql -- "SELECT id, candidate_id, ord, LENGTH(vec) as vec_bytes FROM event_vectors LIMIT 3" -- --local
```

The logs should show:
- URLs being saved to R2
- Events being extracted and stored in D1
- Embeddings being generated (768 dimensions)
- Vectors being stored in both Vectorize and D1 `event_vectors` table
- Example log: `Vector stored in Vectorize + D1: {candidateId}:{ord}`

## Deployment

For production deployment:

1. **Create Cloudflare Resources:**
   ```bash
   # Create Vectorize index
   npx wrangler vectorize create career-events --dimensions=768 --metric=cosine
   
   # Create D1 database
   npx wrangler d1 create app
   
   # Create R2 bucket
   npx wrangler r2 bucket create raw-artifacts
   
   # Create Queue
   npx wrangler queues create ingest
   ```

2. **Set Production Secrets:**
   ```bash
   wrangler secret put EXA_KEY
   ```

3. **Update `wrangler.toml`** with actual resource IDs from step 1

4. **Run Database Migrations:**
   ```bash
   npx wrangler d1 migrations apply app
   ```

5. **Deploy:**
   ```bash
   npm run deploy
   ```

