This Next.js frontend is **self-contained** with the Express API in [`spybot-nextjs/backend`](../backend): auth, vehicles, khanan, and selenium routes all hit that server. There is **no** runtime dependency on the separate Spring Boot app under `spybot/`.

## Environment (`frontend/.env.local`)

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000
```

Point this at wherever `spybot-nextjs/backend` listens (`BACKEND_PORT` in backend `.env`). Restart Next after changes.

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
