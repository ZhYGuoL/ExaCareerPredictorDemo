# Career Path Explorer

A web application that helps users find career paths similar to their own, using Exa Websets for personalized search and discovery.

## Features

- **LinkedIn Profile Integration**: Submit your LinkedIn URL to create a personalized career path Webset
- **User-Specific Websets**: Each user gets their own Exa Webset for personalized results
- **Career Goal Setting**: Define your target roles and companies to enhance search results
- **Similar Path Discovery**: Find profiles with similar educational and career backgrounds

## Setup Instructions

### Prerequisites

- Cloudflare account with Workers, D1, R2, and Queues enabled
- Exa API key

### Installation

1. Clone the repository
2. Run `npm install` to install dependencies
3. Set up your Cloudflare resources:
   - D1 database: `npx wrangler d1 create app`
   - Queue: `npx wrangler queues create ingest`
   - R2 bucket: `npx wrangler r2 bucket create raw-artifacts`

4. Set up your local development environment:
   ```
   # Create .dev.vars file with your Exa API key
   echo "EXA_KEY=your-exa-api-key" > .dev.vars
   ```

5. Run database migrations:
   ```
   npx wrangler d1 execute app --local --file=migrations/0001_init.sql
   npx wrangler d1 execute app --local --file=migrations/0002_event_vectors.sql
   npx wrangler d1 execute app --local --file=migrations/0003_user_websets.sql
   ```

6. Deploy to Cloudflare Workers:
   ```
   npm run deploy
   ```

7. Run database migrations in production:
   ```
   npx wrangler d1 execute app --file=migrations/0001_init.sql
   npx wrangler d1 execute app --file=migrations/0002_event_vectors.sql
   npx wrangler d1 execute app --file=migrations/0003_user_websets.sql
   ```

8. Set the required secret in Cloudflare:
   ```
   npx wrangler secret put EXA_KEY
   ```

## Local Development

Start the development server with:
```
npm run dev
```

## API Endpoints

### LinkedIn Submission
`POST /api/linkedin/submit`
Submit a LinkedIn URL to create or retrieve a user-specific Webset.

Request Body:
```json
{
  "linkedinUrl": "https://www.linkedin.com/in/username",
  "school": "Carnegie Mellon University",
  "major": "Computer Science",
  "gradYear": 2024
}
```

### Career Goal Setting
`POST /api/career-goal/add`
Add a career goal for personalized searching.

Request Body:
```json
{
  "linkedinUrl": "https://www.linkedin.com/in/username",
  "role": "Senior Software Engineer",
  "company": "Google",
  "industry": "Technology",
  "timeframe": "2 years"
}
```

### Webset Search
`POST /api/webset/search`
Search for profiles within a user's Webset.

Request Body:
```json
{
  "websetId": "webset-id-from-previous-request",
  "query": "Senior Engineers who worked at startups"
}
```

### Debug Endpoints
- `GET /api/debug/websets` - List all user Websets
- `GET /api/debug/goals` - List all career goals
- `GET /api/debug/profiles` - List all LinkedIn profiles

## System Architecture

The application uses:
- **Cloudflare Workers** for serverless compute
- **Cloudflare D1** for SQL database storage of user data
- **Cloudflare R2** for storing raw profile data
- **Cloudflare Queues** for background processing of LinkedIn profiles
- **Exa API** for web search and content extraction
- **Exa Websets** for creating personalized collections of profile data