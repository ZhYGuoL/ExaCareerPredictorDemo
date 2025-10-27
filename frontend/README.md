# Career Path Explorer Frontend

React + Vite + TypeScript frontend for the Career Path Explorer application.

## Development

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Build

```bash
npm run build
```

Output is in the `dist/` directory.

## Features

- **Step-based UI**: 3-step wizard for LinkedIn submission, career goals, and results
- **Modern Components**: Built with React + TypeScript
- **Tailwind CSS**: Beautiful, responsive styling
- **Icons**: Lucide React icons
- **State Management**: React hooks + @tanstack/react-query

## Project Structure

```
src/
├── App.tsx                 # Main app component
├── components/
│   ├── LinkedInForm.tsx   # Step 1: LinkedIn profile submission
│   ├── GoalsForm.tsx      # Step 2: Career goals
│   └── Results.tsx        # Step 3: Search results
└── main.tsx               # Entry point
```

## API Integration

Frontend connects to the Cloudflare Workers backend:

- **Development**: Calls `http://localhost:8787/api/*`
- **Production**: Calls `https://career-paths.zguoliau.workers.dev/api/*`

Update the API URL in components or use environment variables.

## Tech Stack

- React 18+
- TypeScript
- Vite
- Tailwind CSS
- Lucide React (icons)
- @tanstack/react-query (state management)