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

- `GET /` - **Web UI** - Interactive career path matcher interface
- `GET /health` - Health check endpoint
- `GET /metrics` - **Observability metrics** (totalRequests, cacheHits, reranks, errors)
- `POST /ingest/start` - Start career path ingestion (generates queries, searches Exa, enqueues URLs)
- `POST /rank/final` - **End-to-end ranking pipeline** (Vectorize shortlist → Soft-DTW re-rank → top-N results)
- `POST /rerank` - Re-rank candidate sequences using Soft-DTW (Durable Object)
- `GET /debug/exa?q=<query>` - Test Exa API integration
- `GET /debug/r2?key=<path>` - Retrieve stored R2 object for debugging

### Web UI

Open `http://localhost:8787/` in your browser for an interactive interface:

1. **Fill in your profile**: School, major, graduation year
2. **Set your goal**: Target company and target year (freshman/sophomore/junior/senior)
3. **Add your events**: Paste JSON array of your career timeline events:
   ```json
   [
     {
       "role": "Research Assistant",
       "org": "Stanford AI Lab",
       "acad_year": "freshman"
     },
     {
       "role": "Software Engineer Intern",
       "org": "Google",
       "acad_year": "sophomore"
     }
   ]
   ```
4. **Click Search**: Results appear in a table with candidate IDs, scores, and URLs

The UI calls `/rank/final` behind the scenes and displays the top matching career paths.

### Example Usage (API)

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

## Observability

The system includes comprehensive observability features for monitoring and debugging:

### Request Tracking

Every request to the ReRanker Durable Object is assigned a unique **request ID** (8-character hex) for tracing:

```bash
curl -X POST http://localhost:8787/rerank ... | jq .reqId
# Output: "8a2fb8fb"
```

### Timing Metrics

Requests return detailed timing breakdowns:

```json
{
  "reqId": "920f3cbf",
  "cached": false,
  "timings": {
    "embedMs": 910, // Time to embed user events
    "loadMs": 17, // Time to load candidate sequences from D1
    "dtwMs": 0, // Time to sort results
    "totalMs": 932 // Total request time
  }
}
```

Cache hits show minimal `totalMs` since no computation is needed.

### Performance Counters

The `/metrics` endpoint exposes real-time counters from the ReRanker Durable Object:

```bash
curl http://localhost:8787/metrics
```

```json
{
  "totalRequests": 15, // Total requests processed
  "cacheHits": 8, // Requests served from cache
  "reranks": 7, // Cache misses requiring computation
  "errors": 0 // Failed requests
}
```

**Key Metrics:**

- **Cache Hit Rate:** `cacheHits / totalRequests` (higher is better)
- **Error Rate:** `errors / totalRequests` (lower is better)
- **Rerank Count:** Number of expensive Soft-DTW computations

### Structured Logging

All cache misses log detailed metrics in JSON format for analysis:

```json
{
  "reqId": "920f3cbf",
  "embedMs": 910,
  "loadMs": 17,
  "dtwMs": 0,
  "totalMs": 932,
  "candidateCount": 2,
  "cacheSize": 1
}
```

Use `wrangler tail` to stream logs during development.

## LLM-Based Event Extraction

The system uses **Workers AI** (Llama 3.1 8B Instruct) for intelligent event extraction from unstructured text with automatic fallback to heuristic extraction.

### How It Works

**LLM Extraction** (`extractLLM`):

1. Sends page text to Workers AI with structured JSON prompt
2. Requests specific schema: `{events: [{role, org, start_iso, end_iso, acad_year, ord}]}`
3. Retries up to 2 times if JSON parsing fails
4. Falls back to heuristic keyword extraction if LLM fails

**Heuristic Fallback** (`extractEvents`):

- Searches for keywords: "intern", "research", "offer"
- Extracts matching lines as events
- Always available as a safety net

### Extraction Quality

The LLM extractor provides:

- **Better accuracy**: Understands context and relationships
- **Structured data**: Extracts company names, roles, dates, and academic years
- **Resilience**: Automatic fallback ensures data is never lost
- **Cost-effective**: Only runs on ingestion (cached afterward)

Example extracted event:

```json
{
  "role": "Software Engineering Intern",
  "org": "Google",
  "start_iso": "2024-06",
  "end_iso": "2024-08",
  "acad_year": "junior",
  "ord": 0
}
```

### Monitoring

Watch for these log messages:

- `[LLM Extract] Found N events (attempt 1)` - Successful extraction
- `[LLM Extract] Attempt N failed: ...` - Retry in progress
- `[LLM Extract] Falling back to heuristic extraction` - Using fallback

## Scripts

- `npm run dev` - Start local development server
- `npm run deploy` - Deploy to Cloudflare Workers
- `npm run typecheck` - Run TypeScript type checking
- `npm run lint` - Run ESLint to check code quality
- `npm run format` - Format code with Prettier
- `npm run check` - Run type checking and linting (CI equivalent)
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
    ├── extract.ts    # LLM-based + heuristic event extraction
    ├── store.ts      # D1 database operations (upsert/insert)
    ├── embed.ts      # Workers AI embedding generation + Vectorize storage
    └── companyGraph.ts # Company similarity graph for ranking
migrations/
└── 0001_init.sql     # Initial database schema
```

## Architecture

The project uses a queue-based architecture with multiple stages:

1. **API Worker** (`src/index.ts`) - Receives ingestion requests, searches Exa API, enqueues URLs
2. **Queue Consumer** (`src/ingest-worker.ts`) - Processes URLs from the queue:
   - Fetches page contents via Exa API
   - Stores raw JSON in R2 (using SHA-1 hash of URL as key)
   - **Extracts career events using LLM** (Workers AI Llama 3.1 8B Instruct):
     - Structured JSON extraction with retry logic (up to 2 attempts)
     - Falls back to heuristic keyword matching if LLM fails
     - Extracts: role, organization, dates (ISO-8601), academic year, sequence order
   - Upserts candidate record in D1 (using URL hash as ID)
   - Inserts extracted events into D1 with proper relationships
   - Generates embeddings using Workers AI (@cf/baai/bge-base-en-v1.5, 768 dimensions)
   - Stores embeddings in **both** Vectorize (for semantic search) and D1 `event_vectors` table (for fast re-ranking)
3. **D1 Database** - Stores normalized career path data
4. **R2 Storage** - Stores raw page contents for processing
5. **Cloudflare Queue** - Decouples ingestion from processing for scalability
6. **Vectorize** - Vector database for semantic similarity search across career events
7. **Workers AI** - Generates text embeddings for semantic understanding and LLM-based event extraction
8. **Durable Object (ReRanker)** - Stateful re-ranking service using Soft-DTW algorithm for sequence similarity
   - Loads candidate event sequences from D1 `event_vectors` table
   - Embeds user's career events on-the-fly using Workers AI
   - Computes Soft-DTW distance between sequences (considers order and timing)
   - **Blended Scoring:** Combines Soft-DTW with company similarity
     - **70% Soft-DTW:** Sequence similarity based on career trajectory
     - **30% Company Proximity:** Goal-based company similarity scoring
       - Exact match (e.g., Google → Google): 1.0
       - Close neighbor (e.g., Google → YouTube): 0.8
       - Cross-FAANG (e.g., Google → Meta): 0.65
       - Other companies: 0.3 (baseline)
     - Company graph includes: Google/YouTube/DeepMind, Meta/Instagram/WhatsApp, Microsoft/LinkedIn/GitHub, Amazon/AWS
   - Returns similarity scores in (0,1] range (higher = better match)
   - **Caching:** In-memory cache with TTL (10 min) and LRU eviction (200 entry cap)
     - Cache key: SHA-1 hash of `{userEvents, candidateIds, gamma, goal}`
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

## Code Quality & CI/CD

### Code Quality Tools

The project uses industry-standard code quality tools:

**ESLint** - Static code analysis to catch errors and enforce coding standards:

```bash
npm run lint
```

**Prettier** - Automatic code formatting for consistent style:

```bash
npm run format
```

**TypeScript** - Type checking for type safety:

```bash
npm run typecheck
```

### Configuration

- **`.prettierrc`** - Prettier configuration (single quotes, semicolons, trailing commas)
- **`eslint.config.mjs`** - ESLint 9 flat config with TypeScript support
- **`tsconfig.json`** - TypeScript compiler options for Cloudflare Workers

### Running All Checks

Before committing, run the full check suite:

```bash
npm run check
```

This runs both type checking and linting, matching what CI will run.

### Continuous Integration

GitHub Actions automatically runs on every push and pull request:

**Workflow:** `.github/workflows/ci.yml`

**Checks:**

1. **Type Checking** - Ensures TypeScript types are correct
2. **Linting** - Verifies code quality standards
3. **Dry Run Deploy** - Validates Wrangler configuration

View CI status in the "Actions" tab on GitHub.

**Best Practices:**

- Run `npm run format` before committing to auto-fix formatting
- Run `npm run check` locally before pushing to catch issues early
- All CI checks must pass before merging PRs
