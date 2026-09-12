# CLAUDE.md — Order Tracker (project brain)

This file is read automatically by every Claude Code session in this repo. It is the
**shared memory** for the project: architecture, how to run/deploy, and the non-obvious
decisions made over time. Keep it updated when we change how things work. It is committed
to git, so it travels to every machine and teammate (unlike the local `~/.claude` memory).

Sister app: **DTF Monitor** (see its own `CLAUDE.md`) — the printer-floor monitor at
dtfproductionstatus.com; its agent talks back to this app's `/integrations/*`.

## What this is
Self-hosted multi-store Shopify order tracker replacing an old Google Sheets + AppSheet +
Apps Script setup. Backend: Node + TypeScript + Express + Prisma + PostgreSQL. Frontend:
React + Vite + TS. Deployed on Railway. Business timezone is **Texas / America/Chicago**
everywhere user-facing (deadlines etc. always shown in Texas time, not the viewer's).

## Run locally (dev) — never touches production
A `docker-compose.dev.yml` runs an **isolated Postgres 18** on `localhost:5544`
(db `order_tracker`, user `postgres`, pass `pg`) — matches `backend/.env`.
```
docker compose -f docker-compose.dev.yml up -d          # start dev DB (Docker Desktop must be running)
cd backend  && npx prisma migrate deploy && npm run dev # API on :3000
cd frontend && npm run dev                              # app on :5173 (proxies /api -> :3000)
```
Log in with normal credentials. To load realistic data, snapshot prod into the dev DB
(read-only on prod), matching PG major versions (**prod is Postgres 18**):
```
PRODURL=$(railway variables --service Postgres --json | python -c "import sys,json;print(json.load(sys.stdin)['DATABASE_PUBLIC_URL'])")
docker exec ot-dev-db pg_dump "$PRODURL" --no-owner --no-privileges -Fc -f /tmp/prod.dump
docker exec ot-dev-db pg_restore --no-owner --no-privileges -U postgres -d order_tracker /tmp/prod.dump
```
Working locally never affects prod; **only `railway up` deploys.**

## Deploy (production)
- `railway up --service order-tracker --detach` from the repo root. **Deploy = uploading the
  working directory** (NOT git push); uncommitted changes still deploy. On start it runs
  `migrate:deploy` then `seed` then `start`; the root build compiles frontend then backend.
- Domain: https://order-tracker-production-5a11.up.railway.app · health `/health`.
- Railway project `order-tracker` (id d69e3e36… is DTF Monitor; OT project id
  04e142cf-e135-4f43-98c0-541ab18f7428). Prod is **Postgres 18**.
- Verify a deploy is live: backend-only changes don't change the JS bundle hash — check
  `railway logs --service order-tracker` for "listening on port". Frontend changes: poll the
  `/assets/index-*.js` hash until it changes.

## Prod DB access (read/write scripts)
`railway variables --service Postgres --json` → `DATABASE_PUBLIC_URL`. Run one-off Prisma/
ts-node scripts with `DATABASE_URL="$PRODURL"`. `dotenv` does NOT override an already-set
`DATABASE_URL`, so a shell-set prod URL wins over `backend/.env`.

## Migrations
Hand-written SQL under `backend/prisma/migrations/<timestamp>_<name>/migration.sql`, applied
by `migrate:deploy` on deploy. Add the column/table to `schema.prisma` AND a migration file.

## Roles & access
`User.role` is a free-form string ("ADMIN" + built-ins DESIGNER/MACHINIST/CUSTOMER_SERVICE/
VIEWER + admin-defined custom roles). Column visibility/edit per role lives in AppConfig
`rolePermissions` (see `backend/src/config/permissions.ts`). Per-user tab flags: `canViewReports`,
`canViewSheets`, `canViewStaff`, `canViewFinance`.
- Reports/Sheets/Staff: ADMIN auto-has access; others need the flag.
- **Finance is special**: even ADMIN needs `canViewFinance` (no auto-access), and *granting*
  that flag requires a password checked server-side against env `FINANCE_UNLOCK_PASSWORD`
  (so a random admin can't self-enable it). Owner (r.alp.dalkir) and Sena have it.

## Webhooks (Shopify → OT)
Per-store webhook `POST /webhooks/<STORE>`; raw events saved to `WebhookEvent` (inbox), then
routed by `classifyWebhook` (`backend/src/services/shopify.ts`) → creation / fulfillment /
cancellation. Admin can replay via `POST /events/:id/reprocess`.
- **Cancellation = only a real cancel** (`orders/cancelled`, `cancelled_at`, or `cancel_reason`).
  A `financial_status: "voided"` payment does NOT mean cancelled — those orders are real and
  ARE created. (Fixed 2026-09: voided-but-open orders like #MS4131 were being dropped.)

## Shipping / pickup, and Production views
`resolveShipping` (`backend/src/services/shipping.ts`) sets `isPickup` + `displayShippingMethod`.
Sidebar "Production" views map to server slices in `backend/src/routes/orders.ts` (`viewWhere`):
fortworth, houston, mesquite, richardson, **detroit** (PICASSO orders whose shipping contains
"Detroit" → labelled "Detroit Pick-up"), outsidepickup. See the per-store shipping-string
reference in the memory note `picasso-shipping-methods`.

## Sheets (monthly account tracking) + warehouse split
`backend/src/services/sheetCategories.ts` classifies each Shopify line item into a category
(UV, DTF, Custom Shirt, Sweatshirt, Sublimation, DTF Ink, Powder, DTF Film, Heat Tape, Teflon,
… dynamic ones by product name). Inch-kind vs count-kind. `Order.categoryMeasures` stores the
precomputed `{categoryKey: value}` per order so Sheets sums stored numbers. UV & DTF are
**split** across warehouses (Promo=base, Cheetah/Houston/Mesquite) via `SheetEntry.splitPct`,
pulled from DTF Monitor (`/sheets/pull-split`).

## Finance tab (`backend/src/routes/finance.ts`, `frontend/src/components/FinancePanel.tsx`)
Per-store monthly income statements (`FinanceStatement`, `data` JSON = `{values, notes, custom, hidden}`).
- Revenue = net sales + shipping; COGS = sum of its rows; Net income = income − COGS − expenses.
- **General/Bilanço**: months × Gelir/Gider/Fark + partner Dağılım. Top tab = all stores; each
  store tab has its own "Summary". Partner splits are **effective-dated per store** (AppConfig
  `financeSplits` = `{store: [{start:YYYYMM, partners:[{name,pct}]}]}`), profit split is
  **proportional** (need not sum to 100). Edit in a store's Summary → ⚙ Settings.
- Rows: add/remove custom rows per section (Edit-rows mode); memo rows (Jasa debt, Cash balance)
  are recorded but excluded from P/L.
- **COGS auto-calc (⚙ COGS on a month)**: dynamic list of that month's Sheets categories.
  UV/DTF → pick warehouses + price/inch (only selected warehouses' inches billed); others →
  measure × unit price. Config saved per store in AppConfig `financeCogsConfig`. Opening the
  modal first pulls the latest warehouse split (throttled to **once/day/month** via AppConfig
  `financePullLog`). "Calculate & fill" is authoritative: wipes the COGS section, refills from
  the shown data, hides products not sold that month. New/unpriced categories are flagged.
- Endpoints: `/finance` (GET year, PUT upsert), `/finance/splits`, `/finance/cogs-config`,
  `/finance/cogs-measures`, `/finance/pull-split`. Data files were imported from the finance
  xlsx workbooks (Jan–Jul 2026, 10 stores).
- COGS is manual unless the operator runs ⚙ COGS. Annual "2025" summary sheets not imported.

## Print progress from the floor (DTF Monitor → `/integrations/print`)
Two modes on the same endpoint (`backend/src/routes/integrations.ts`, `X-Api-Key`):
- **Order-level (legacy)**: `{orderCode, machine, operator, printStatus}` sets the order's
  printStatus/machineName/machinistName directly (old RIPLOG "auto-complete" + Complete button).
- **Per-sheet (2026-09, agent Queue)**: `{orderCode, part, total, copies, stage: ripped|printed,
  machine, operator, fileName, printedCount}` upserts a **`Sheet`** row (`@@unique(orderId, part)`)
  and **rolls the order up**: all parts printed → `Printed`; some → `Printed 2/5`; only RIP'd →
  `RIP'd 1/5`; machineName/machinistName = comma-joined contributors. Only the exact value
  `Printed` counts as done (Not-Printed view = `printStatus != 'Printed'`), so a split order
  keeps showing as work until every sheet went through the oven. `GET /integrations/order-status`
  returns the sheets too. Chase list / thresholds are the planned next step on top of this.

## Delivery (planned, mostly not built here)
PICASSO local delivery uses Shopify native Local Delivery + the EasyRoutes app, NOT a custom
build. Phase 2 (future): OT adds a `ready-to-deliver` Shopify tag when a delivery order is
printed. See memory note `delivery-feature` / the plan file.

## Conventions & gotchas
- **Deploy is `railway up`, not git.** Committing is separate (do it when the user asks).
- Setting Railway env vars that contain leading-slash paths from **Git Bash** gets MSYS-mangled
  (e.g. `/PRODUCTION` → `C:/Program Files/Git/PRODUCTION`). Prefix with `MSYS_NO_PATHCONV=1`
  or use the Railway MCP.
- Prefer the ⚙/settings and per-store config patterns already established; keep user-facing
  strings in **English** (the app is English even though we chat in Turkish).
- Deeper point-in-time notes live in `~/.claude/.../memory/` (local only). This CLAUDE.md is
  the portable source of truth — prefer updating it.
