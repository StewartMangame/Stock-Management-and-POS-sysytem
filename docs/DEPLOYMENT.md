# Production Deployment Guide: Vercel & Neon PostgreSQL

Ace Holdings Stock Management & Point of Sale (POS) System

---

## 1. Architecture Overview & Region Alignment

* **Frontend & API Application**: Next.js 15 App Router hosted on **Vercel Serverless**.
* **Database**: **Neon PostgreSQL** serverless cluster accessed via `@neondatabase/serverless` WebSocket pool.
* **Region Alignment & Latency Minimization**:
  * **Neon Database Region**: Select the Neon database region deliberately based on end-user location and Vercel compute topology (e.g. Frankfurt `aws-eu-central-1` or Ohio `aws-us-east-2`).
  * **Vercel Function Region Match**: In `vercel.json`, ensure `"regions": ["fra1"]` (or the corresponding datacenter code) matches the exact cloud region of the Neon database. Running serverless functions in the same region as the database prevents cross-continental round-trip latency on WebSocket database connections and interactive transactions.
* **Separation of Roles**:
  * **Runtime Application**: Connects via `DATABASE_URL` using the restricted role `ace_app_user`.
  * **Database Migrations**: Executed strictly from developer workstations or CI/CD pipelines via `MIGRATION_DATABASE_URL` using the owner role (`neondb_owner`). **Migrations never run during the Vercel build process.**
* **Point-in-Time Restore**: The recovery window and retention period depend strictly on the active Neon tier (e.g., Free tier: 24 hours; Launch/Scale tier: up to 30 days of PITR history). Weekly `pg_dump` backups must be stored in secure offsite cloud storage.

---

## 2. Database Roles & Privilege Setup

The application uses least-privilege role segregation to enforce data immutability:

### Step 2.1: Owner Role (`neondb_owner`)
* Has full DDL privileges.
* Used exclusively to execute `npm run db:migrate`.
* Connection string: Direct unpooled endpoint (`ep-xyz.region.neon.tech`).

### Step 2.2: Runtime Role (`ace_app_user`)
* Created via Migration 0010 without a hardcoded password.
* Set its password **without it appearing in logs** using one of these two methods:

  **Option A — Neon Console (recommended):**
  1. Open the Neon Console → your project → **Roles**.
  2. Click the `ace_app_user` role → **Reset password**.
  3. Copy the generated password and store it in your secrets manager.

  **Option B — `psql` interactive prompt (password is never echoed or logged):**
  ```bash
  psql "postgresql://neondb_owner:OWNER_PASSWORD@ep-xyz.region.neon.tech/neondb?sslmode=require"
  # Inside psql:
  \password ace_app_user
  # Enter new password: (typed, not visible)
  # Enter it again:   (typed, not visible)
  \q
  ```

  > ⚠️ **Never** run `ALTER ROLE ace_app_user WITH PASSWORD '...'` — the password
  > appears in the PostgreSQL statement log and in your shell history.

* Granted DML (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) on operational tables.
* **Revoked dangerous permissions**:
  * Cannot `UPDATE`, `DELETE`, or `TRUNCATE` audit logs (`audit_log`).
  * Cannot `UPDATE`, `DELETE`, or `TRUNCATE` accounting journals (`journal_batches`, `journal_lines`, `journal_source_events`).
  * Cannot perform DDL (`CREATE`, `DROP`, `ALTER`).
* Future tables automatically inherit privileges via `ALTER DEFAULT PRIVILEGES` (Migration 0013).
* Connection string: Pooled endpoint (`ep-xyz-pooler.region.neon.tech`).

---

## 3. Environment Variables

Configure the following variables in the **Vercel Project Settings > Environment Variables**:

| Variable | Environment | Type | Purpose |
| :--- | :--- | :--- | :--- |
| `APP_ENV` | Production, Preview | String | Set to `production` for Production; `staging` for Preview deployments. **Required.** |
| `DATABASE_URL` | Production, Preview | Secret | Pooled connection string for runtime role (`ace_app_user`). |
| `AUTH_SECRET` | Production, Preview | Secret | 32-byte base64 secret (`openssl rand -base64 32`). |
| `AUTH_URL` | Production, Preview | URL | Canonical deployment URL (`https://your-domain.vercel.app`). |
| `CRON_SECRET` | Production, Preview | Secret | Secret token sent by Vercel Cron as Bearer header. |
| `HEALTH_CHECK_SECRET` | Production, Preview | Secret | Secret token for external uptime monitoring (`x-health-check-secret`). |
| `ONEKHUSA_MODE` | Production, Preview | String | `live` for Production; `sandbox` (or empty) for Staging; `mock` for Local only. (`mock` is blocked in production). |
| `ONEKHUSA_BASE_URL` | Production, Preview | URL | `https://api.onekhusa.com/v1` (Production) or `https://api.onekhusa.com/sandbox/v1` (Staging). |
| `ONEKHUSA_API_KEY` | Production, Preview | Secret | API key. |
| `ONEKHUSA_API_SECRET` | Production, Preview | Secret | API secret. |
| `ONEKHUSA_ORGANISATION_ID` | Production, Preview | String | Merchant organization ID. |
| `ONEKHUSA_MERCHANT_ACCOUNT_NUMBER` | Production, Preview | Number | Merchant account number. |
| `ONEKHUSA_WEBHOOK_SECRET` | Production, Preview | Secret | HMAC-SHA512 webhook signature secret. |
| `EIS_ENABLED` | Production | Boolean | `true` when MRA EIS integration is activated; `false` otherwise. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Production, Preview | Public | Cloudflare Turnstile public site key. |
| `TURNSTILE_SECRET_KEY` | Production, Preview | Secret | Cloudflare Turnstile secret key. |
| `PROTECTED_DB_HOSTS` | Production, Preview | String | Comma-separated hostnames protected against destructive scripts. |

> ⚠️ **CRITICAL SECURITY RULES**:
> 1. `MIGRATION_DATABASE_URL` MUST NEVER be set in Vercel.
> 2. `ADMIN_SEED_PASSWORD` MUST NEVER be set in Vercel (local CLI seed only).
> 3. No sensitive credentials may ever carry the `NEXT_PUBLIC_` prefix.

---

## 4. Staging & Preview Deployments Checklist

### 4.1 Staging Environment Variables List
When deploying to Staging / Preview on Vercel, configure:
* `APP_ENV=staging` (enables yellow top-banner across all pages and prints red `STAGING, TEST DATA, NOT A REAL TAX INVOICE` on all receipts and invoices)
* `ONEKHUSA_MODE=sandbox` (or left empty; never `mock` in staging or production)
* Unified OneKhusa Credentials: `ONEKHUSA_BASE_URL`, `ONEKHUSA_API_KEY`, `ONEKHUSA_API_SECRET`, `ONEKHUSA_ORGANISATION_ID`, `ONEKHUSA_MERCHANT_ACCOUNT_NUMBER`, `ONEKHUSA_WEBHOOK_SECRET`
* Cloudflare Turnstile Keys: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`
* `HEALTH_CHECK_SECRET` (for external uptime monitors querying `/api/health/db`)
* **NO `ADMIN_SEED_PASSWORD`**: Admin password seed is strictly run locally on developer machines, never exposed to Vercel environment variables.

### 4.2 Behavior When OneKhusa Is Unconfigured in Non-Mock Environments
When `APP_ENV` is `staging` or `production` and OneKhusa credentials are not supplied:
* Payment methods requiring the online gateway (mobile money push prompts for Airtel Money / TNM Mpamba) are automatically hidden from the POS and payment selection UI.
* A clear notification is surfaced to cashiers: *"Online payment gateway is not configured for this environment. Please record transactions via Cash, Physical Card Terminal, or Bank Transfer."*

### 4.3 Preview Deployments & Cookie Isolation
1. **Database Isolation**:
   * Preview deployments use the **Staging database** branch on Neon.
   * Vercel **Deployment Protection** (Authentication / Password) must remain **ENABLED** for all Preview deployments.
2. **Session Cookie Isolation**:
   * Session cookies are environment-namespaced:
     * Staging: `__Secure-ace.staging.session-token`
     * Production: `__Secure-ace.production.session-token`
   * Session expiration is strictly capped at **12 hours** (`maxAge: 43200`).

---

## 5. Deployment Step-by-Step Procedure

### Step 5.1: Run Schema Migrations (Outside Vercel)
From your secure terminal or CI pipeline:
```bash
# 1. Provide the direct owner connection string
export MIGRATION_DATABASE_URL="postgresql://neondb_owner:SECRET@ep-xyz.region.neon.tech/neondb?sslmode=require"

# 2. Run migrations
npm run db:migrate
```
* The migration script verifies owner privileges, prints target host and database, and requires typing the database name for non-local targets.

### Step 5.2: Initialize Production Data (Fresh Deployment Only)
If this is the initial launch of an empty production database:
```bash
export MIGRATION_DATABASE_URL="postgresql://neondb_owner:SECRET@ep-xyz.region.neon.tech/neondb?sslmode=require"
export ADMIN_SEED_PASSWORD="SetAStrongTemporaryPassword123!"

npm run seed:production
```
* Creates roles, default location (`MAIN`), initial admin (`admin@ace.co.mw` with forced password change), single 17.5% VAT rate, blank company settings, standard units of measure, number sequences starting at 1, account mappings, and the system Walk-in customer.

### Step 5.3: Deploy to Vercel
Push your branch to GitHub or run:
```bash
vercel --prod
```
* Vercel will execute `npm run build` (`next build`). The build succeeds without requiring database access.

---

## 6. Scheduled Cron Jobs (`vercel.json`)

Vercel Cron automatically triggers the following routes using `Authorization: Bearer <CRON_SECRET>`:

| Job Name | Schedule | Path | Description |
| :--- | :--- | :--- | :--- |
| **Provider Reconciliation** | `*/5 * * * *` (5 min) | `/api/cron/provider-reconciliation` | Sweeps pending OneKhusa mobile money/card transactions. |
| **EIS Outbox Worker** | `*/5 * * * *` (5 min) | `/api/cron/eis` | Batches outbound invoices to MRA EIS server. |
| **Held-Sale Cleanup** | `0 * * * *` (Hourly) | `/api/cron/cleanup-held-sales` | Purges abandoned POS held carts older than 24 hours. |
| **Stock Snapshot** | `0 22 * * *` (Midnight Blantyre) | `/api/cron/stock-snapshot` | Daily inventory balance snapshot per warehouse/outlet. |
| **Quotation Expiry** | `0 22 * * *` (Midnight Blantyre) | `/api/cron/expire-reservations` | Releases stale stock reservations and marks quotes expired. |

* All cron routes record heartbeats in the `cron_runs` table.
* The system checks suite includes a **"Workers Alive"** test alerting if provider reconciliation or EIS worker has been inactive for > 15 minutes.

---

## 7. Health Checks & Monitoring

* **Liveness Probe**: `GET /api/health`
  * Public endpoint.
  * Makes **zero database calls**. Returns `{ "status": "ok" }`.
  * Used by external status monitors and load balancers.
* **Database Readiness Probe**: `GET /api/health/db`
  * Protected endpoint. Requires header `x-health-check-secret: <HEALTH_CHECK_SECRET>`.
  * Executes `SELECT 1` on the database.
  * Returns `{ "status": "ok", "db": "connected" }` or HTTP 503 without leaking stack traces or credentials.

---

## 8. Backup & Disaster Recovery

### 8.1: Neon Point-in-Time Recovery (PITR)
* Neon provides instant point-in-time recovery via branching.
* **Restore Window**: The PITR history window depends on your Neon pricing plan:
  * **Free Tier**: 24 hours
  * **Launch Plan**: 7 days
  * **Scale Plan**: Up to 30 days
* *Note: Do not rely on automated daily snapshot backups without verifying your plan's retention window.*

### 8.2: Weekly Offsite Backups (`pg_dump`)
Run a scheduled weekly logical backup stored outside Neon (e.g. AWS S3, Cloud Storage):
```bash
pg_dump "postgresql://neondb_owner:PASSWORD@ep-xyz.region.neon.tech/neondb?sslmode=require" \
  --format=custom \
  --file="ace_backup_$(date +%Y%m%d).dump"
```
Encrypt and store the dump file in an immutable offsite storage bucket.

### 8.3: Disaster Recovery & Restore Test Procedure
Verify backup integrity monthly by restoring into a fresh Neon branch:
1. Create a temporary branch from the backup or Neon branch manager:
   ```bash
   neon branches create --name restore-test-$(date +%Y%m%d)
   ```
2. Point your local test environment to the restored branch URL.
3. Run the automated System Checks suite:
   ```bash
   npx tsx -e "import { runSystemChecks } from './src/server/services/system-checks'; runSystemChecks().then(r => console.log('Status:', r.status, 'Checks:', r.totalChecks));"
   ```
4. Verify that Customer Credit Balances, Serial Number Inventories, Stock Reservations, and Double-Entry General Ledgers all report `pass`.
5. Delete the temporary test branch.

---

## 9. Rollback Procedures

### Application Rollback:
If an issue is detected after deployment, trigger an immediate instant rollback in Vercel:
1. Go to **Vercel Dashboard > Deployments**.
2. Locate the previous working deployment.
3. Click the three dots menu `...` and select **Instant Rollback**.
4. Traffic is rerouted immediately within seconds.

### Database Rollback Policy:
* **Forward-Only Migrations**: All migrations must be backward-compatible.
* Never drop columns, rename active tables, or add non-nullable columns without default values in a single migration.
* If a code deployment is rolled back, the forward-compatible database schema will continue to support the previous application version.

