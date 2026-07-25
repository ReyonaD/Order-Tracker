# Order Tracker — Backend

Self-hosted, multi-store Shopify order tracker. Replaces the old Google Apps Script +
Google Sheets + AppSheet system. Node + TypeScript + Express + Prisma + PostgreSQL.

## Local setup

```bash
cd backend
npm install
cp .env.example .env          # fill in DATABASE_URL + JWT_SECRET
npx prisma migrate dev --name init
npm run seed                  # seeds 10 stores + an admin user
npm run dev                   # http://localhost:3000
```

Default admin (change after first login): `admin@ordertracker.local` / `changeme123`
(override with `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars before running seed).

## API overview

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/webhooks/:store` | HMAC | Shopify webhook (create / fulfill / cancel) |
| POST | `/auth/login` | — | Log in, returns JWT |
| GET  | `/auth/me` | JWT | Current user |
| GET  | `/orders` | JWT | List orders (filters: store, status, search, loaded, page) |
| GET  | `/orders/:id` | JWT | Order detail |
| PATCH| `/orders/:id` | JWT | Update workflow columns (role-gated) |
| GET  | `/stores` | JWT | List stores (for filters) |
| PATCH| `/stores/:id` | ADMIN | Configure store + webhook secret |
| GET  | `/health` | — | Health check |

## Shopify webhook configuration

For each store, create webhooks (Settings → Notifications → Webhooks, or via API) for:
- `orders/create`
- `orders/fulfilled` (and/or `fulfillments/create`)
- `orders/cancelled`

Point them all at:
```
https://<your-railway-host>/webhooks/<STORE_CODE>
```
e.g. `https://ordertracker.up.railway.app/webhooks/CHEETAH`

Then set each store's `webhookSecret` (the Shopify webhook signing secret) via
`PATCH /stores/:id` so HMAC verification passes. For local testing you can set
`SKIP_WEBHOOK_VERIFICATION=true` to bypass verification.

## Deploy on Railway

1. Create a Railway project, add a **PostgreSQL** plugin (provides `DATABASE_URL`).
2. Add a service from this repo, root directory `backend/`.
3. Set env vars: `JWT_SECRET`, `TZ` (e.g. `America/Chicago`), `CORS_ORIGINS`.
4. Railway runs `npm run build`, then `npm run migrate:deploy && npm start` (see `railway.json`).
5. Run the seed once (Railway shell): `npm run seed`.

## What changed from the Apps Script system

- **No queue / no per-minute cron** — a real server processes webhooks instantly.
- **No "Yarin" nightly job** — deadlines are stored as real timestamps; the frontend
  renders "Today / Tomorrow X PM".
- **Data-driven stores** — store colors, cutoffs, Shopify ids live in the DB, not code.
- **DB-level duplicate protection** — `shopifyOrderId` is unique (upsert).
