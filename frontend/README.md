This Next.js frontend is **self-contained** with the Express API in [`spybot-nextjs/backend`](../backend): auth, vehicles, khanan, and selenium routes all hit that server. There is **no** runtime dependency on the separate Spring Boot app under `spybot/`.

## Environment (`frontend/.env.local`)

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000
```

Point this at wherever `spybot-nextjs/backend` listens (`BACKEND_PORT` in backend `.env`). Restart Next after changes.

**Dev bundler:** `pnpm dev` uses **`next dev --webpack`** (not Turbopack) for more stable local runs on Windows; production `pnpm build` is unchanged.

### Quick QA (manual)

| Check | Expected |
|-------|-----------|
| `/` | Redirects to `/login` |
| `/login` | Form visible immediately (no infinite blank); sign-in posts to `NEXT_PUBLIC_API_BASE_URL/api/auth/generate-token` |
| `/dashboard/*` without token | Redirect to `/login` |
| `/dashboard/leads` etc. with token | Dashboard layout + page |
| Backend `GET /health` | `{ "status": "OK", ... }` |

### Khanan and Leads synchronization

- Khanan scrape writes raw rows to `khanan_data`.
- Leads dashboard reads `vehicle_trip_summary` (`/api/vehicle/trip-summary` and `/api/vehicle/stats`).
- If auto-sync is not enabled in backend, run `Sync Vehicles` on Leads (calls `POST /api/vehicle/sync`) after scraping so Leads reflects latest Khanan rows.
- Scraper API now blocks redundant runs when requested date scope is already present in `khanan_data`; backend returns a clear skip message.
- `last run` is persisted in DB-backed scraper state, so restart/reload still shows latest completed run metadata.

## Run

1. Start backend: `cd spybot-nextjs/backend && npm run dev`
2. Start frontend: from repo root `pnpm dev` or `cd spybot-nextjs/frontend && pnpm dev`
3. Optional: `cd spybot-nextjs/backend && npm run sync:user` for default local user (`admin` / `admin123`) if needed.

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)

## Deploy on Vercel

See [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying).
