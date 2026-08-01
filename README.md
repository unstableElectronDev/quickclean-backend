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

## API surface

| Route | Role | Purpose |
|---|---|---|
| `POST /api/auth/login` | public | Sets `qc_session` httpOnly cookie |
| `POST /api/auth/logout` | any | Clears the cookie |
| `GET /api/auth/me` | authenticated | Current session — used by the frontend for every auth check |
| `POST /api/auth/set-password` | invite-token | Consumes an invite, activates the account |
| `POST /api/auth/resend-invite` | admin | Re-issues an expired invite |
| `GET/POST /api/users` | admin | List / invite users |
| `PATCH/DELETE /api/users/:id` | admin | Change role/status, soft-deactivate |
| `GET /api/brands` | authenticated | List brands |
| `POST /api/brands` | admin | Create a brand directly (rarely needed — Properties uploads auto-create brands) |
| `POST /api/uploads` | admin | Multipart upload — `fileType` (one of six, see below) + `file`, and `parentGroup` when required. Parses & validates, returns a preview, does not write anything yet |
| `GET /api/uploads/:id/preview` | admin | Re-fetch a pending preview |
| `POST /api/uploads/:id/commit` | admin | Writes the parsed rows per `fileType` (see below) |
| `DELETE /api/uploads/:id` | admin | Discards a previewed (not yet committed) upload |
| `GET /api/uploads` | admin | Upload history |
| `GET /api/uploads/:id/reference` | admin | Archived QC Average / Brand Average / Data Validation rows for one upload |
| `GET/POST /api/qc-sites` | authenticated / admin | List / create Current Sites registry entries (one at a time, via form) |
| `PATCH/DELETE /api/qc-sites/:id` | admin | Edit / remove a site |
| `GET /api/qc-sites/:id/match-suggestions` | admin | Fuzzy-matched candidate properties (Dice coefficient on name + city) |
| `POST /api/qc-sites/:id/match` | admin | Confirm `matched_property_id` |
| `GET /api/pipeline-leads` | admin, sales_head | List imported sales-pipeline leads |
| `GET /api/pipeline-leads/summary-by-state` | admin, sales_head | State x Industry pivot (counts) |
| `GET /api/properties` | authenticated | List properties — filters: `parentGroup`, `brandId`, `region`, `propertyType`, `q` (name/city/state search) |
| `GET /api/properties/:id` | authenticated | Single property |
| `GET /api/properties/:id/reference` | authenticated | That property's matched QC Average / Brand Average / Data Validation rows, joined by `(brand.parentGroup, srNo)` — not a stored FK |

Every route re-checks role independently server-side — this is the actual enforcement point, not the frontend's UI or middleware.

## Upload file types

A single `POST /api/uploads` endpoint handles six distinct file types, selected via the `fileType` field — each has its own real-world column layout (see `src/lib/upload-parsers.ts` for the exact header-matching dictionaries):

| `fileType` | Needs `parentGroup`? | What it does |
|---|---|---|
| `PROPERTIES` | Yes | Upserts `properties` by `(brandId, srNo)`. Spans every sub-brand under the given parent group — each row's own `Brand` column resolves (and auto-creates, if new) the specific `Brand` record scoped to that parent group. |
| `QC_AVERAGE` | Yes | Archives rows verbatim into `upload_reference_archive`; matches to an existing property by `(brand, srNo)` for provenance, doesn't write to `properties`. |
| `BRAND_AVERAGE` | Yes | Same as `QC_AVERAGE`. |
| `DATA_VALIDATION` | Yes | Same as `QC_AVERAGE`, plus applies its "Data Validation Link" column as `properties.source_url` on the matched row. |
| `CURRENT_SITES` | No | Upserts `qc_operational_sites` by `site_code` — **in addition to** the one-at-a-time admin form, not instead of it. Both write to the same table. |
| `LEADS_PIPELINE` | No | Bulk-inserts into `pipeline_leads` (see Notes) — no matching/upsert, every valid row is a new record. |

`PROPERTIES`/`QC_AVERAGE`/`BRAND_AVERAGE`/`DATA_VALIDATION` uploads are conceptually one client-group's data cycle split across separate files (matching the real filenames: "IHCL Properties", "QC Average", "IHCL Average", "Data Validation") — they cross-reference each other by `(Brand, Sr. No.)`, not by upload ID, so they can be uploaded in any order.

## Notes

- `qc_operational_sites.created_by` is `ON DELETE RESTRICT`, not the design doc's `SET NULL` — the column is `NOT NULL` and MySQL can't null a non-nullable column on delete. Users are only ever soft-deleted (`status='deactivated'`), so this doesn't come up in practice.
- `FRONTEND_URL` is used to build invite links (`/set-password?token=...`) since this API has no pages of its own.
- `properties` has an added `@@unique([brandId, srNo])` (not in the original design doc) so re-uploading updates existing rows by Sr. No. instead of duplicating them.
- `qc_operational_sites.property_type` and `uploads.parent_group` were added beyond the original design doc's schema — the former because the real Current Sites file has a Property Type column the doc's schema didn't capture (kept as free text since it spans Healthcare + Hospitality, not just Resort/Hotel); the latter because `uploads.brand_id` had to become nullable once a single upload could span many brands.
- `pipeline_leads` is an entirely new table, not in the original design doc — it's CRM-style sales pipeline data (Lead Owner, Lead Status, Estimated Revenue, etc.), unrelated to the existing `leads` table (which is the system-generated QC-site-to-property proximity match).
- The `xlsx` package on npm carries known, unpatched high-severity CVEs (ReDoS, prototype pollution) — exactly the attack surface that matters for a feature that parses untrusted uploads. This installs SheetJS's own patched build directly from `cdn.sheetjs.com` instead (see `package.json`), which is their documented fix channel.
- Upload preview data lives in an in-process `Map` (`src/lib/upload-store.ts`), not a database or Redis — matches the design doc's "in-memory only, no S3" intent. It does **not** survive a server restart between preview and commit; `commit` returns a 409 telling the admin to re-upload if that happens. Fine for a single-instance deployment; would need Redis behind a load balancer.
- Not yet built: calc engine, map & proximity leads, hardening (Phases 3–5 of the design doc).
