# Ace Holdings POS — Developer Setup

Stock management, sales and point-of-sale system for **Ace Holdings Limited**, Blantyre, Malawi.

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 20 LTS or later |
| npm | 10 or later |
| PostgreSQL | 15 or later (Neon recommended) |

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

## Available scripts

| Script | Description |
|---|---|
| `npm run dev` | Start Next.js development server |
| `npm run build` | Build production bundle |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | TypeScript type check (no emit) |
| `npm run db:generate` | Generate Drizzle SQL migrations from schema |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Seed baseline data (idempotent) |
| `npm run db:studio` | Open Drizzle Studio (DB browser) |
| `npm test` | Run unit tests (Vitest) |
| `npm run test:watch` | Vitest watch mode |
| `npm run format` | Format all files with Prettier |

---

## Running integration tests

Integration tests (migration + seed) require a **separate test database** to avoid touching production data.

```bash
# Create a .env.test file
echo 'DATABASE_URL_TEST=postgresql://user:password@host/testdb?sslmode=require' > .env.test
echo 'ADMIN_SEED_PASSWORD=TestPass1!' >> .env.test

npm test
```

Tests that require `DATABASE_URL_TEST` are skipped automatically when the variable is not set.

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
  authorize.test.ts       Permission matrix tests
  money.test.ts           Money arithmetic tests
  settings.test.ts        Settings service tests
  migrations-seed.test.ts Integration: clean DB → migrate → seed
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
- Login is rate-limited to **5 failed attempts per IP per 15 minutes** (stored in `login_attempts` table).
- Every sensitive server action calls `authorize()` which **re-reads the user's role from the database** — role changes take effect without a re-login.
- Card numbers are never stored. Only the approval code and terminal reference are kept.
- Provider secrets (OneKhusa, EIS) are server-only environment variables — never exposed to the browser.

---

## Database backup

Neon provides automated daily backups. For a self-hosted PostgreSQL, add this to cron:

```bash
# Daily backup at 02:00
0 2 * * * pg_dump $DATABASE_URL | gzip > /backups/ace_pos_$(date +\%Y\%m\%d).sql.gz
```

Keep at least 30 days of backups. Test restores quarterly.

---

## Implementation phases

| Phase | Status | Scope |
|---|---|---|
| **0** | ✅ Complete | Project setup, auth, roles, layout, settings, seed |
| 1 | Pending | Products, stock ledger, purchasing, goods received |
| 2 | Pending | Customers, quotations, invoices, delivery notes, PDFs |
| 3 | Pending | Payments, allocations, aged debtors |
| 4 | Pending | Counter POS, shifts, cash-up |
| 5 | Pending | OneKhusa, EIS, card reconciliation |
| 6 | Pending | Reports, dashboard data |
| 7 | Pending | Offline PWA, multi-location transfers |

---

## Logo

Place the Ace Holdings logo at `/public/brand/ace-logo.png`.  
Until it is supplied, the sidebar and login page show a navy "A" placeholder.
