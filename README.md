# OneInbox Dashboard

Simple web UI for OneInbox customers to log in and manage API keys.

## Features

- **Login** — email + password only (accounts created during manual onboarding)
- **API Keys** — list, create, and revoke keys

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:5173

## Environment

| Variable | Description |
| --- | --- |
| `VITE_API_URL` | OneInbox API base URL (default: `https://api.oneinbox.ai`) |

In development, leave `VITE_API_URL` empty to use the Vite proxy (`/v1` → API server) and avoid CORS issues.

On Vercel, production uses `vercel.json` to proxy `/v1` → `https://api.oneinbox.ai` so the browser stays on the dashboard origin.

## Build

```bash
npm run build
npm run preview
```

Static output is in `dist/`.

## API endpoints used

- `POST /v1/auth/login`
- `POST /v1/auth/logout`
- `GET /v1/auth/me`
- `GET /v1/api-keys`
- `POST /v1/api-keys`
- `DELETE /v1/api-keys/{key_id}`
