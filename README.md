# Ace Holdings POS — Developer Setup

Stock management, sales and point-of-sale system for **Ace Holdings Limited**, Blantyre, Malawi.

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 20 LTS or later |
| npm | 10 or later |
| Docker Desktop | 24 or later (for local integration tests) |
| PostgreSQL | 15 or later (Neon recommended for dev/prod; Docker for tests) |

---

## First-time setup

### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd ace-holdings-pos
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in at minimum:

```
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
AUTH_SECRET=<run: openssl rand -base64 32>
ADMIN_SEED_PASSWORD=<a strong password for the first admin>
```

> **Never commit `.env`.**  Only `.env.example` is committed.

### 3. Run database migrations

```bash
export MIGRATION_DATABASE_URL=postgresql://owner:pass@host/dbname?sslmode=require
npm run db:migrate
```

This applies all SQL files in `src/server/db/migrations/` in order.
Re-running is safe — already-applied migrations are skipped.

### 4. Seed the database

```bash
npm run db:seed
```

Creates:
- Roles (admin, manager, sales, storekeeper, cashier, viewer) with permissions
- Main Outlet location (code: `MAIN`)
- VAT 17.5% (1750 basis points, default)
- All default settings
- Number sequences (MAIN-INV, MAIN-QT, etc.)
- Admin user `admin@ace.co.mw` — **must change password on first login**

The seed script is **idempotent** — running it multiple times is safe.

### 5. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
Log in with `admin@ace.co.mw` and the password set in `ADMIN_SEED_PASSWORD`.

---

## Running integration tests (Docker Postgres)

The test suite runs against a **local Docker Postgres instance** so tests are fast and
isolated — no network calls to Neon or any remote service.

### Step 1 — Start Docker Postgres

```bash
docker compose up -d
# Wait for the healthcheck to pass (~10 s):
docker compose ps
```

This starts Postgres 16 on port **5433** with two databases:
- `acetest` — shared integration test database (all test files)
- `acemigrationtest` — throwaway database (schema-reproducibility test only)

### Step 2 — Create `.env.test`

```bash
cp .env.test.example .env.test
```

The example already contains the correct Docker connection strings.
If you use Neon for tests instead, replace the URLs with your Neon strings.

### Step 3 — Run the suite

```bash
npm test
```

Before Vitest starts, the `pretest` script automatically migrates the test database
so you never need to migrate manually between code changes.

### Stopping the container

```bash
docker compose down          # stop, keep the data volume
docker compose down -v       # stop and wipe all data (clean slate)
```

---

## Available scripts

| Script | Description |
|---|---|
| `npm run dev` | Start Next.js development server |
| `npm run build` | Build production bundle |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | TypeScript type check (no emit) |
| `npm run audit:check` | Fail on HIGH+ npm vulnerabilities (quality gate) |
| `npm run quality:check` | Run typecheck + lint + audit + build |
| `npm run db:generate` | Generate Drizzle SQL migrations from schema |
| `npm run db:migrate` | Apply pending migrations (requires MIGRATION_DATABASE_URL) |
| `npm run db:seed` | Seed baseline data (idempotent) |
| `npm run seed:production` | Idempotent production seed (roles, admin, VAT, sequences) |
| `npm run db:studio` | Open Drizzle Studio (DB browser) |
| `npm test` | Run unit + integration tests (Vitest), auto-migrates test DB first |
| `npm run test:watch` | Vitest watch mode |
| `npm run secret-scan` | Scan git history for accidentally committed secrets |
| `npm run format` | Format all files with Prettier |

---

## Project structure

```
src/
  app/               Next.js App Router pages and layouts
    (auth)/          Login and change-password (no shell)
    (app)/           Authenticated pages (sidebar + topbar)
      admin/users/   User management
      admin/settings/ App settings
      dashboard/     Dashboard
  components/
    shell/           Topbar, Sidebar, Providers
    ui/              shadcn/ui components (Ace-themed)
  server/
    auth/            authorize() helper
    db/              Drizzle schema, migrations, seed, migrate runner
    services/        Business logic (users, settings, audit, rate-limit)
  lib/               money.ts, validation.ts, permissions.ts, utils.ts
  types/             next-auth.d.ts type augmentation
tests/
  authorize.test.ts              Permission matrix tests
  money.test.ts                  Money arithmetic tests
  settings.test.ts               Settings service tests
  migrations-seed.test.ts        Schema reproducibility: empty DB → migrate → seed
  deployment-readiness.test.ts   Deployment safety guards
  runtime-role.test.ts           Runtime role privilege tests
  phase1-stock.test.ts           Inventory integration tests
  phase2-sales.test.ts           Sales / documents integration tests
  phase3-payments.test.ts        Payments, allocations, AR tests
  phase4-pos.test.ts             Counter POS and shift tests
  ...
docker/
  postgres-init.sql              Container init SQL (creates acemigrationtest DB)
docker-compose.yml               Local Postgres for tests
docs/
  DEPLOYMENT.md                  Production deployment guide
```

---

## Database migrations

Migrations live in `src/server/db/migrations/` as plain SQL files, named `NNNN_description.sql`.

- To add a table or column: create a new SQL file with the next sequence number.
- **Never edit or delete existing migration files** — create a new migration that alters the table.
- Run `npm run db:generate` to generate a migration from the Drizzle schema, then review the output before applying.

---

## Security notes

- Passwords are hashed with **argon2** (`@node-rs/argon2`, 64 MiB memory cost).
- Sessions are JWT-based (Auth.js v5, credentials provider). The `AUTH_SECRET` must be a strong random value.
- Login is rate-limited to **5 failed attempts per IP per 15 minutes** (stored in `login_attempts` table, database-backed).
- Every sensitive server action calls `authorize()` which **re-reads the user's role from the database** — role changes take effect without a re-login.
- Card numbers are never stored. Only the approval code and terminal reference are kept.
- Provider secrets (OneKhusa, EIS) are server-only environment variables — never exposed to the browser.
- The runtime role `ace_app_user` cannot UPDATE/DELETE audit logs or accounting journals.

---

## Database backup

See `docs/DEPLOYMENT.md` for the full backup and restore procedure.

Neon provides point-in-time recovery. Run a weekly `pg_dump` stored outside Neon:

```bash
pg_dump "$MIGRATION_DATABASE_URL" \
  --format=custom \
  --file="ace_backup_$(date +%Y%m%d).dump"
```

---

## Implementation phases

| Phase | Status | Scope |
|---|---|---|
| **0** | ✅ Complete | Project setup, auth, roles, layout, settings, seed |
| 1 | ✅ Complete | Products, stock ledger, purchasing, goods received |
| 2 | ✅ Complete | Customers, quotations, invoices, delivery notes, PDFs |
| 3 | ✅ Complete | Payments, allocations, aged debtors |
| 4 | ✅ Complete | Counter POS, shifts, cash-up |
| 5 | ✅ Complete | OneKhusa, EIS, card reconciliation |
| 6 | ✅ Complete | Reports, dashboard data |
| 7 | 🚧 In progress | Deployment readiness, security hardening |

---

## Logo

Place the Ace Holdings logo at `/public/brand/ace-logo.png`.
Until it is supplied, the sidebar and login page show a navy "A" placeholder.
