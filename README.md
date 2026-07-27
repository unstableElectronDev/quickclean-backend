# QuickClean Backend

Standalone Express + TypeScript API for the QuickClean Brand Intelligence Portal. Owns the database (Prisma + MySQL) and all business logic. Paired with [quickclean-frontend](../quickclean-frontend), which proxies to this service — see that repo's README for how the two connect.

## Stack

- Express + TypeScript (plain `tsx`/`tsc`, no framework magic)
- Prisma 5 + MySQL 8
- JWT sessions in an httpOnly cookie (`jsonwebtoken`, `bcryptjs`)

## Setup

```bash
nvm use 20   # requires Node 20+ (pinned in .nvmrc)
npm install

cp .env.example .env
# edit .env: DATABASE_URL, JWT_SECRET (openssl rand -base64 32), FRONTEND_URL, CORS_ORIGIN

npm run db:migrate   # applies prisma/schema.prisma
npm run db:seed      # bootstrap admin + GLOBAL benchmarks + a sample brand

npm run dev           # http://localhost:4001
```

Seed creates the first admin account (no public sign-up — someone has to bootstrap it):
- email: `admin@quickclean.internal` (or `SEED_ADMIN_EMAIL`)
- password: `ChangeMe123!` (or `SEED_ADMIN_PASSWORD`)

## API surface (Phase 1)

| Route | Role | Purpose |
|---|---|---|
| `POST /api/auth/login` | public | Sets `qc_session` httpOnly cookie |
| `POST /api/auth/logout` | any | Clears the cookie |
| `GET /api/auth/me` | authenticated | Current session — used by the frontend for every auth check |
| `POST /api/auth/set-password` | invite-token | Consumes an invite, activates the account |
| `POST /api/auth/resend-invite` | admin | Re-issues an expired invite |
| `GET/POST /api/users` | admin | List / invite users |
| `PATCH/DELETE /api/users/:id` | admin | Change role/status, soft-deactivate |

Every route re-checks role independently server-side — this is the actual enforcement point, not the frontend's UI or middleware.

## Notes

- `qc_operational_sites.created_by` and `uploads.created_by` are `ON DELETE RESTRICT`, not the design doc's `SET NULL` — both columns are `NOT NULL` and MySQL can't null a non-nullable column on delete. Users are only ever soft-deleted (`status='deactivated'`), so this doesn't come up in practice.
- `FRONTEND_URL` is used to build invite links (`/set-password?token=...`) since this API has no pages of its own.
- Not yet built: TAM upload pipeline, Current Sites form, calc engine, map & proximity leads (Phases 2–5 of the design doc).
