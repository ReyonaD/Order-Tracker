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
- Revenue = sum of ALL income rows (fixed + custom, minus hidden — fixed 2026-09-18, it used to be
  only net sales + shipping so custom income rows didn't move it); COGS and Operating expenses =
  sum of their rows (both shown as totals); Net income = income − COGS − expenses.
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
  returns the sheets too. Stages: `downloaded` (→ `Downloaded n/N`, clears later stages = restart
  of that sheet), `ripped`, `printed`. `urgent: true` (file name began with `++`) sets `Order.urgent`;
  it is never un-set by the integration (manual choice). Chase list sorts urgent first within a flag.
- **RUSH (2026-10-09):** a file name starting with `+++` is RUSH — one level above urgent
  (`++`). The floor sends `rush: true`; OT sets `Order.rush` (never un-sets it; no manual edit —
  it is the floor's flag). Shown as an orange RUSH tag next to the order number + orange row stripe,
  in the chase list (sorted rush → urgent → deadline) and the floor queue. `++` alone still = urgent.
- **Reprints (2026-09-25):** a per-sheet `printed` call with `reprint: true` (file name contains
  `REPRINT`, detected by DTF Monitor) does NOT overwrite the Sheet's original printer; it increments
  `Sheet.reprints`, sets `lastReprint*`, and logs a `PrintEvent` (kind print|reprint — every confirmed
  print is logged). Rollup shows `Picasso_M_1 · R: Picasso_M_3` / `EMRE · R: ALI` in the order's
  machine/operator columns; `order-status` returns `events`. Reprint downloaded/RIP'd stages are
  ignored so the order stays `Printed`.
- **Times of the floor's actions (2026-10-02):** `Order.printStatusAt` = when the print status last
  changed (set by the per-sheet rollup from the sheets' `downloadedAt`/`rippedAt`/`printedAt`/
  `lastReprintAt`, by the legacy order-level call, and by a manual edit of the Print column; null
  when cleared). The Print column shows it under the status ("2:41 PM" today, "Sep 26, 2:41 PM"
  otherwise — Texas time). `PrintEvent` now logs EVERY stage (`downloaded` | `ripped` | `print` |
  `reprint`) with machine + operator, and the ⟳ popover lists them newest-first; steps from before
  this change are rebuilt from the Sheet timestamps (`timeline()` in `PrintHistoryButton.tsx`).
- **Floor queue** (sidebar, everyone): DTF Monitor's per-machine board proxied via `GET /chase/floor`
  (server-side fetch of `<DTF_MONITOR_URL>/api/queue/all` with `DTF_MONITOR_API_KEY`) so no second login.
- **Chase list** (`backend/src/routes/chase.ts` → `GET /chase`, `frontend/src/components/ChasePanel.tsx`,
  sidebar "🔥 Chase list", visible to everyone): orders with `status NEW`, deadline in
  [today−3d, end of today] (Texas) and `printStatus != Printed`, each with the stage it is stuck
  in (`not_started` / `downloaded` / `ripped` / `partial`), who/where, and a flag: overdue → late;
  not started & due ≤ 2 h → warn; Downloaded 30/60 min, RIP'd 45/90, partial 45/90 → warn/late.
  Sorted late → warn → ok, refetches every 30 s, "Day is clean" when empty.
  **Settings** (panel ⚙, AppConfig `chaseSettings`, `GET/PUT /chase/settings`, PUT = ADMIN):
  `lookbackDays` (default **0 = today only** — prod has ~40 unmarked orders/day and ~130 in the
  previous 3 days, all of which show as late if the window is widened), `notStartedWarnMin`,
  and `[warn, late]` minutes for downloaded / ripped / partial. Rows have **"Mark printed"**
  (= `PATCH /orders/:id {printStatus:"Printed"}`, same role permissions as the table) to clear
  orders that were printed but never recorded by the old flow.

## Stock Inventory (`backend/src/routes/stock.ts`, `services/stock*.ts`, `frontend/src/components/stock/`, built 2026-10-31)
Consumables (ink, film, powder…) per warehouse; replaces the separate PHP "DTF Stock" site. Sidebar
tab, **visible to every OT user** (no second login). Changing stock from the web needs
`User.canManageStock` (ADMIN always; checkbox in Admin → Users). Telegram settings = ADMIN.
- **Warehouses + machines are mirrored from DTF Monitor** (`GET <DTF_MONITOR_URL>/api/integrations/warehouses`)
  into `StockWarehouse`: every 5 min, on opening the tab (60 s stale) and via a button. New ones appear
  by themselves; removed ones go `active=false` and keep stock + history. An empty answer never
  deactivates anything. There is no rename: a renamed warehouse is a new one, stock stays on the old row.
- **All quantity changes go through `services/stock.ts`**: one conditional `UPDATE … WHERE quantity >= q`
  (so no negative stock, also a DB CHECK) + a `StockMovement` with before/after. Lists are all-or-nothing.
  `StockBatch.requestKey` makes every list idempotent: retries/double clicks/the agent's outbox can't
  deduct twice. Kinds: stock | consumption | transfer | reversal | adjustment. History can reverse a consumption or a stock-in (refused if that stock is already gone). The "Correct stock" tab sets a level to the real count; an adjustment never counts as usage. Lock order is fixed (product id, warehouse id).
- **Machine usage**: `/integrations/stock/{state,use,undo}` (`X-Api-Key`), called only by the DTF Monitor
  server, which adds the warehouse from its machine record. Agents have no login: machine + operator
  identify who. Undo = same machine within 15 min; later a manager reverses it in History.
- **Low-stock threshold**: `StockProduct.minStock` is the default; `StockLevel.minStock` (nullable) overrides it for one warehouse. Always read `level.minStock ?? product.minStock`. `StockLevel.tracked=false` = that warehouse doesn't keep the product: never low/out, no alert, hidden from its lists and agents while its quantity is 0.
- **Categories**: AppConfig `stockCategories`, added/renamed/deleted in the Products tab. DTF and UV are locked: an agent's Stock tab opens on its machine's type, but every machine can reach every category. A category in use cannot be deleted.
- **Telegram**: `stockJobs.ts` (every minute) sends low-stock crossings, the daily report at `summaryTime`
  (Texas) and, only if `notifyUsage` is on (off by default — too noisy), a message per usage; each is a
  checkbox in Stock settings. `stockBot.ts` long-polls on its own loop and answers `/menu` with report buttons
  (summary, stock per warehouse, low/out, today's usage, weekly, by machine, by person, received today, month CSV)
  plus typed commands in TR/EN/ES. **The inline menu is always the chat's last message** (`repostMenu`): after any
  message in the chat, report, alert or daily report the old menu is deleted and a new one sent (AppConfig
  `stockTelegramMenu` holds its id). Seeing members' messages needs the bot's group privacy off. Lists are grouped by category. Token: `TELEGRAM_BOT_TOKEN` or the Stock
  settings (never returned by the API). Nothing is queued while disabled. Only ONE app may poll a bot token:
  stop the old PHP site's cron before enabling it here.
- **This tab is the exception to "English only"**: it has en/tr/es (`components/stock/i18n.ts`, per browser).
  Its look (paper + mint + CMYK line, from the old stock app) lives in `components/stock/stock.css`, scoped under `.sk`.

### Shopify-linked stock (Cheetah T-shirts, 2026-11-07)
`services/stockShopify.ts`, called from `processWebhook` (a stock failure never fails the order). A product with
`StockProduct.shopifyKey` = `"store|product title|variant title"` (lowercased, e.g.
`cheetah|gildan light cotton t-shirt|large/black`; variant words sorted, hyphens split, number-only words
dropped, so "Dark Grey Heather" = "Heather Dark Grey" and "navy-1" = "Navy" — `shopifyKeyOf`) is taken out of the warehouse **named like the store code**
(CHEETAH) when the order webhook arrives (consumption, actor "Shopify", source `shopify`, note `Shopify #C…`),
applied once per order (StockBatch `shopify:<STORE>:<orderId>`); a cancellation reverses those movements once.
Shopify sales are never refused: if the count is short, stock stops at 0 and the note says "N not in stock".
Walk-in sales = ordinary stock out. Shopify's own inventory is NOT updated (our app is the stock of record).
Seeded by migration `20261107120000_stock_shopify_tshirts`: Bella Canvas 3001 (72) + Gildan 3000 (96; Heather Dark Grey S
added by `20261107140000_stock_gildan_hdg_small`) in category "T-Shirt", tracked only in CHEETAH. Colors use the names Shopify puts in
ORDERS (the products CSV export has metaobject handles like `dark-grey` that do NOT match) — all 105 variants seen
in real orders matched. A linked line whose variant matches nothing is logged as StockAudit `shopify.unmatched`
(new color/renamed product → add the product / fix its `shopifyKey`). Refunds/order edits don't change stock.

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
