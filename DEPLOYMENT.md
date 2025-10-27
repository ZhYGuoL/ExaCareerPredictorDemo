# Deployment Guide

## Project Structure

```
ExaCareerPredictorDemo/
├── src/                    # Cloudflare Workers backend (API routes)
│   ├── index.ts           # Main worker entrypoint
│   ├── lib/
│   └── components/
├── frontend/               # React + Vite frontend
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── LinkedInForm.tsx
│   │   │   ├── GoalsForm.tsx
│   │   │   └── Results.tsx
│   └── package.json
└── wrangler.toml          # Cloudflare configuration
```

## Architecture

- **Backend**: Cloudflare Workers (API routes, database, queues)
- **Frontend**: Vite + React (modern UI)
- **Deployment**: Cloudflare Pages (frontend) + Cloudflare Workers (backend)

## Development

### Start Backend (Workers)
```bash
npm run dev  # Uses wrangler.toml
```

### Start Frontend
```bash
cd frontend
npm run dev  # Runs on http://localhost:5173
```

### Frontend connects to Backend
The frontend makes API calls to:
- Development: `http://localhost:8787/api/*`
- Production: `https://career-paths.zguoliau.workers.dev/api/*`

## Deployment

### Option 1: Deploy Frontend to Cloudflare Pages

1. **Build the frontend**:
```bash
cd frontend
npm run build
```

2. **Deploy via Wrangler** (add this to wrangler.toml):
```toml
[[pages]]
directory = "./frontend/dist"
```

Or use Cloudflare Dashboard: Upload the `frontend/dist` folder to a new Pages project.

### Option 2: Deploy Both Together

Create a GitHub action or use `wrangler pages deploy`:

```bash
# Deploy Workers (backend)
wrangler deploy

# Deploy Pages (frontend)
cd frontend
npm run build
wrangler pages deploy ./dist --project-name=career-paths
```

## Current Setup

- **Backend URL**: `https://career-paths.zguoliau.workers.dev`
- **Frontend**: Run locally with `npm run dev` from frontend directory
- **Integration**: Frontend calls backend API at `/api/*` routes

## Next Steps

1. Update frontend API calls to use production URL
2. Add environment variable handling for API URL
3. Deploy frontend to Cloudflare Pages
4. Set up custom domain (optional)

## API Endpoints

- `POST /api/linkedin/submit` - Submit LinkedIn profile
- `POST /api/webset/search` - Search within user's Webset
- `POST /api/career-goal/add` - Add career goal
- `GET /api/debug/*` - Debug endpoints
