# brainiac
A tiny thought-capture app.

- Frontend: React SPA (Vite) in `src/`
- Backend: Cloudflare Worker in `worker/`
- Storage: Cloudflare D1 (SQLite)
- Async analysis: Cloudflare Queues
- Auth: Google sign-in via Firebase Auth
- AI tagging: Cloudflare AI (default model `@cf/openai/gpt-oss-20b`)

## Features (current)
- Sign in with Google.
- Create thoughts.
- Browse thoughts newest-first.
- Browse tags with counts.
- Filter thoughts by AND’ing tags.
- Edit / soft-delete thoughts.
- On create/edit, a tagging job is enqueued; the tagger considers existing tags and current tags.

## Local development
### 1) Install
```bash
npm install
```

### 2) Firebase setup (one project for dev + prod)
1. Create a Firebase project.
2. Enable **Authentication → Sign-in method → Google**.
3. Add your local dev origin (e.g. `http://localhost:5173`) to **Authorized domains**.

Create a `.env.local` file for Vite:
```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
```

### 3) Worker env vars
The Worker needs the Firebase project id to verify ID tokens.

For local dev, create a `.dev.vars` file:
```bash
FIREBASE_PROJECT_ID=your-firebase-project-id
AI_TAGGER_MODEL=@cf/openai/gpt-oss-20b
```

For deployed environments, set `FIREBASE_PROJECT_ID` via `wrangler.jsonc` vars or Wrangler secrets/vars.

### 4) D1 database + migrations
This repo stores schema migrations in `migrations/`.

Create the database (once):
```bash
wrangler d1 create brainiac
```

Apply migrations locally:
```bash
wrangler d1 migrations apply brainiac --local
```

Apply migrations to production:
```bash
wrangler d1 migrations apply brainiac
```

Note: you may need to add the created D1 database id/name to `wrangler.jsonc` depending on your Wrangler workflow.

### 5) Queues
Create the queues:
```bash
wrangler queues create brainiac-analysis
wrangler queues create brainiac-analysis-dlq
```

### 6) Run dev server
```bash
npm run dev
```

## Deploy
```bash
npm run deploy
```

## Architecture notes
### Why a single Worker (for now)
We run both HTTP API (`fetch`) and queue consumption (`queue`) in one Worker to keep iteration fast and deployment simple.

We may split into separate Workers later if we need:
- independent deploy cadence for API vs workers
- different scaling/performance tuning
- stronger isolation between queue retries/failures and the HTTP path
- different auth/permissions boundaries

## Useful commands
- Tests: `npm run test:run`
- Lint: `npm run lint`
- Regenerate Worker env/runtime types: `npm run cf-typegen`
