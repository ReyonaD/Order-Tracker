
# Order Tracker

Self-hosted, multi-store Shopify order tracking system — a from-scratch replacement for
the old Google Apps Script + Google Sheets + AppSheet setup. Runs on Railway with its own
PostgreSQL database, so there's no dependency on Google and full freedom to customize.

## Structure
- **`backend/`** — Node + TypeScript + Express + Prisma API. Receives Shopify webhooks,
  stores orders in PostgreSQL, serves the REST API with auth + roles. *(Phase 1 — done)*
- **`frontend/`** — React + Vite web app: order table, filters, colors, workflow columns,
  role-based views. *(Phase 2 — next)*
- **`memory-bank/`** — project documentation & decisions (brief, product, system, tech,
  active context, progress).

## How it works
```
Shopify stores → POST /webhooks/<STORE> → HMAC verify → classify (create/fulfill/cancel)
              → PostgreSQL → React app (orders table, workflow editing)
```

See `backend/README.md` for setup, API, and Railway deployment. See `memory-bank/` for the
full plan and rationale.

## Status
- ✅ Phase 1: Backend + Database (webhooks, business logic, auth, orders API)
- ⏳ Phase 2: React frontend
