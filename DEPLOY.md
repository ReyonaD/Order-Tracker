# Deploying to Railway

The whole app deploys as **one Railway service** (backend serves the built React app)
plus a **PostgreSQL** database. The Railway CLI is already installed on this machine.

## What happens on deploy
- Build: `npm run build` → builds the frontend, then the backend.
- Start: `npm run start` → runs DB migrations, seeds first-run data, serves the app.
- Migrations and first-run seed (10 stores, dropdowns, admin user) run automatically.

## Steps

### 1. Log in (interactive — you must do this)
```bash
railway login
```
This opens a browser. After it succeeds, `railway whoami` shows your account.

### 2. Create the project
```bash
cd "C:/Users/Alp_office/Documents/Order Tracker"
railway init            # give it a name, e.g. "order-tracker"
```

### 3. Add PostgreSQL
```bash
railway add --database postgres
```
(or run `railway add` and pick PostgreSQL from the menu)

### 4. Set environment variables on the app service
```bash
railway variables --set "JWT_SECRET=<a-long-random-string>" \
                  --set "TZ=America/Chicago" \
                  --set "ADMIN_EMAIL=you@yourcompany.com" \
                  --set "ADMIN_PASSWORD=<your-strong-password>"
```
Generate a JWT secret with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

### 5. Link the database URL
The app service needs `DATABASE_URL` pointing at the Postgres you added. Easiest in the
Railway dashboard → your **app service → Variables → New Variable**:
```
DATABASE_URL = ${{Postgres.DATABASE_URL}}
```
Railway autocompletes the `${{...}}` reference. (CLI alternative:
`railway variables --set "DATABASE_URL=\${{Postgres.DATABASE_URL}}"`.)

### 6. Deploy
```bash
railway up
```
This uploads the repo, builds, runs migrations + seed, and starts the app.

### 7. Get a public URL
```bash
railway domain
```
Open the URL and log in with the ADMIN_EMAIL / ADMIN_PASSWORD you set.

## Importing the historical orders (optional, once)
The 14k historical orders live only in the local dev DB. To load them into Railway,
run the importer against the production DB (get the public DATABASE_URL from the
Railway dashboard → Postgres → Connect → Public Network):
```bash
cd backend
DATABASE_URL="<railway-public-postgres-url>" npx ts-node scripts/importCsv.ts "../Order Tracking - Sheet9 (1).csv"
```

## Point Shopify webhooks at the app
For each store, in Shopify **Settings → Notifications → Webhooks**, create webhooks for
**Order creation**, **Order fulfillment**, and **Order cancellation**, all pointing to:
```
https://<your-railway-domain>/webhooks/<STORE_CODE>
```
e.g. `https://order-tracker.up.railway.app/webhooks/CHEETAH`

Then, in **Admin → Stores**, paste each store's Shopify signing secret (shown at the
bottom of the Shopify Webhooks page) so HMAC verification passes. Until you do, set the
env var `SKIP_WEBHOOK_VERIFICATION=true` if you want to test without it (less secure).

## Redeploys
After code changes: `railway up` again. Migrations run automatically; the first-run seed
is skipped once stores exist, so your data and settings are preserved.
