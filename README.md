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
| `GET /api/reference-data?sheetName=X&parentGroup=Y` | admin | Archived rows across all uploads for one sheet, deduped to the most recent row per Sr. No. (see Notes) |
| `GET/POST /api/qc-sites` | authenticated / admin | List / create Current Sites registry entries (one at a time, via form) |
| `PATCH/DELETE /api/qc-sites/:id` | admin | Edit / remove a site |
| `GET /api/qc-sites/:id/match-suggestions` | admin | Fuzzy-matched candidate properties (Dice coefficient on name + city) |
| `POST /api/qc-sites/:id/match` | admin | Confirm `matched_property_id` |
| `GET /api/pipeline-leads` | admin, sales_head | List imported sales-pipeline leads |
| `GET /api/pipeline-leads/summary-by-state` | admin, sales_head | State x Industry pivot (counts) |
| `GET /api/properties` | authenticated | List properties — filters: `parentGroup`, `brandId`, `region`, `propertyType`, `q` (name/city/state search) |
| `GET /api/properties/:id` | authenticated | Single property |
| `GET /api/properties/:id/reference` | authenticated | That property's matched QC Average / Brand Average / Data Validation rows, joined by `(brand.parentGroup, srNo)` — not a stored FK |
| `GET /api/dashboard/overview` | authenticated | Aggregated data for the Dashboard page — totals (including Load/Water/Energy/Cost/Energy Saving, see Notes), by-region, by-city (for the map), by-brand, brands-by-star, and a `coverage` object reporting how many properties actually have a Load benchmark / QC rate / savings match. Filters: `parentGroup`, `brandId`, `region`, `state`, `city`, `starCategory`, `operatedBy`, `propertyType`, `developmentType`, `icpModel`, `aging` (a computed 4-bucket label — `0-2 years` / `2-5 years` / `5-10 years` / `10+ years`, filtered in-memory since it isn't a stored column) |
| `GET /api/dashboard/filter-options?parentGroup=X` | authenticated | Real distinct State / City / Operated By / ICP values for that parent group's properties, for the Dashboard filter panel's dropdowns |
| `GET /api/dashboard/qc-penetration?parentGroup=X` | authenticated | "QC at &lt;client&gt;" — how much of that parent group's portfolio has a confirmed `matched_property_id` link (via the Current Sites fuzzy-match flow), with computed linen load using `src/lib/calc-engine.ts` |
| `GET /api/dashboard/qc-benchmarks?parentGroup=X` | authenticated | Real per-site rates (Price/kg, Water, LPG, PNG, Electricity, Energy Consumption) from that parent group's archived QC Average sheet rows, averaged by Star Category (`computeRateBenchmarks` in `src/lib/calc-engine.ts`) |
| `GET /api/dashboard/savings-analysis?parentGroup=X` | authenticated | "Savings Analysis" page — Water/Energy/Cost saving % and absolute figures (QC Average rate vs. Brand Average baseline rate, by Star Category), CAPEX by region and CO2 Savings (both real, direct per-property Properties-sheet columns — see Notes), top 10 brands by savings, and a Brand-baseline-vs-QuickClean cost comparison by region |
| `GET /api/dashboard/rollout-timeline?parentGroup=X` | authenticated | "Rollout Timeline" page — Brownfield properties split into 4 real aging-based phases (oldest first: 13+ / 10-13 / 8-10 / 0-8 years, via `rolloutPhaseBucket` in `src/lib/calc-engine.ts`), Greenfield kept as one combined bucket, each with real Properties/Rooms/Capex/Annual Load/portfolio-share figures |

Every route re-checks role independently server-side — this is the actual enforcement point, not the frontend's UI or middleware.

## Upload file types

A single `POST /api/uploads` endpoint handles three file types, selected via the `fileType` field (see `src/lib/upload-parsers.ts` for the exact header-matching dictionaries):

| `fileType` | Needs `parentGroup`? | What it does |
|---|---|---|
| `BRAND_FILE` | Yes | One workbook, up to 4 sheets — Properties, QC Average, Brand Average, Data Validation — matching the real client file layout. Sheets are identified by **name** (regex against each sheet's title, e.g. anything containing "propert", "qc.*average", "brand\|ihcl.*average", "data.*valid"), not position, so they can be in any order and any of the 4 can be missing (a workbook with just a Properties sheet is valid). Properties rows upsert `properties` by `(brandId, srNo)`, auto-creating brands under the given parent group from each row's own `Brand` column. The 3 reference sheets archive verbatim into `upload_reference_archive` and match to properties **within the same upload/transaction** by `(brand, srNo)` — Data Validation additionally applies its "Data Validation Link" column as `properties.source_url`. |
| `CURRENT_SITES` | No | Upserts `qc_operational_sites` by `(site_code, client_code)` — **in addition to** the one-at-a-time admin form, not instead of it. Both write to the same table. |
| `LEADS_PIPELINE` | No | Bulk-inserts into `pipeline_leads` (see Notes) — no matching/upsert, every valid row is a new record. |

Because all 4 Brand File sheets are parsed from the same upload, cross-referencing (QC Average → Properties, Data Validation → Properties) is exact and immediate — no dependency on a previous separate upload having already landed, unlike the earlier per-file-type design this replaced.

## Notes

- `qc_operational_sites.created_by` is `ON DELETE RESTRICT`, not the design doc's `SET NULL` — the column is `NOT NULL` and MySQL can't null a non-nullable column on delete. Users are only ever soft-deleted (`status='deactivated'`), so this doesn't come up in practice.
- `FRONTEND_URL` is used to build invite links (`/set-password?token=...`) since this API has no pages of its own.
- `properties` has an added `@@unique([brandId, srNo])` (not in the original design doc) so re-uploading updates existing rows by Sr. No. instead of duplicating them.
- `qc_operational_sites.property_type` and `uploads.parent_group` were added beyond the original design doc's schema — the former because the real Current Sites file has a Property Type column the doc's schema didn't capture (kept as free text since it spans Healthcare + Hospitality, not just Resort/Hotel); the latter because `uploads.brand_id` had to become nullable once a single upload could span many brands.
- `pipeline_leads` is an entirely new table, not in the original design doc — it's CRM-style sales pipeline data (Lead Owner, Lead Status, Estimated Revenue, etc.), unrelated to the existing `leads` table (which is the system-generated QC-site-to-property proximity match).
- The `xlsx` package on npm carries known, unpatched high-severity CVEs (ReDoS, prototype pollution) — exactly the attack surface that matters for a feature that parses untrusted uploads. This installs SheetJS's own patched build directly from `cdn.sheetjs.com` instead (see `package.json`), which is their documented fix channel.
- Upload preview data lives in an in-process `Map` (`src/lib/upload-store.ts`), not a database or Redis — matches the design doc's "in-memory only, no S3" intent. It does **not** survive a server restart between preview and commit; `commit` returns a 409 telling the admin to re-upload if that happens. Fine for a single-instance deployment; would need Redis behind a load balancer.
- `upload_reference_archive` has no upsert — re-committing the same Brand File archives a fresh set of rows every time (unlike `properties`, which upserts by `(brand_id, sr_no)`). So a property uploaded twice shows up twice in the raw archive table. `GET /api/reference-data`, `GET /api/properties/:id/reference`, `GET /api/dashboard/qc-penetration`, and `GET /api/dashboard/qc-benchmarks` all dedup this in-application, keeping only the most recent row per `(sheetName, sr_no)` — rows with no Sr. No. (pivot/summary rows some uploads carry) have no dedup key and pass through unchanged. `GET /api/uploads/:id/reference` intentionally does **not** dedup — it's scoped to one specific upload, so there's nothing to collapse.
- `computeRateBenchmarks` (`src/lib/calc-engine.ts`) reads real archived QC Average rows and groups them by Star Category. It matches columns defensively (normalized, non-alphanumeric-stripped keys) because Excel's multi-line header cells land as literal newlines in the JSON key (e.g. `"Water\n(kL) (Per kg Per day)"`), and it drops rows with a non-integer/missing Star Category — real uploads include pivot-table "Grand Total" rows and blank-star rows that archive verbatim alongside the real data. There is no Business/Residential split in the real data (unlike the original reference mockup), so benchmarks are Star-Category-only, and each fuel-type average (LPG/PNG/Electricity) is computed only across the sites that reported a rate for that fuel.
- `GET /api/dashboard/overview`'s Load/Water/Energy/Cost/Energy Saving totals: Load = `room_load_benchmarks` (parent-group-specific or `GLOBAL` fallback) × room count at 100% occupancy, same as `qc-penetration`. Water/Energy/Cost multiply that load by `getQcAverageBenchmarkMap(parentGroup)`'s per-Star-Category rate (real, from the uploaded QC Average sheet) — this is QuickClean's own measured rate applied portfolio-wide as a projection, not a fabricated number and not a comparison. Energy Saving multiplies that same load by the difference between `getBrandAverageBenchmarkMap(parentGroup)`'s rate (the brand's own baseline, from the uploaded Brand Average sheet, same Star Category) and QC's rate — a genuine before/after saving, computed at the Star Category level rather than per-property since exact per-property QC↔Brand Average pairs are rare in real uploads (checked: only 1 property out of IHCL's 16 QC-operated sites has both rows for the same Sr. No.). `computeRateBenchmarks` in `src/lib/calc-engine.ts` is shared by both sheets — they don't even agree on a column name for the same rate ("Price / kg" vs "Cost/Kg"), so matching is substring-based on normalized keys, not an exact header string. `client_group_benchmarks` (the design doc's intended source for these, with `avg_occupancy`) still isn't populated for any real parent group — no Settings UI exists to enter it — so this is the best real-data-backed number available until that's built.
- Every property gets a Water/Energy/Cost/Energy Saving figure, not just the ones whose exact Star Category has an uploaded rate: `computeRateBenchmarks` also builds a `BLENDED_STAR_CATEGORY` (sentinel `0`) bucket averaging across *all* of a parent group's valid rate rows regardless of star, and `GET /api/dashboard/overview` / `GET /api/dashboard/savings-analysis` fall back to it **per field**, not per row — real uploads can have a star's row populated for Price but blank for Energy (IHCL's 4-star QC Average rows are exactly this), so an all-or-nothing row-level fallback would still leave gaps. Both endpoints' `coverage` report `exact` vs `fallback` counts so the UI can disclose which figures are Star-Category-precise vs blended-estimate. The blended bucket is filtered out of `GET /api/dashboard/qc-benchmarks` (the `/qc-operations` table) — it's a calculation fallback, not a real Star Category to display as a row.
- `computePropertyRates` (`src/lib/calc-engine.ts`) is the shared per-property calculation behind both `GET /api/dashboard/overview` and `GET /api/dashboard/savings-analysis` — one property's Load, QC Average rate, and Brand Average rate, all with the same per-field blended fallback. Kept as one function specifically so the two endpoints can't quietly drift on what counts as "covered."
- `rolloutPhaseBucket` / `ROLLOUT_PHASE_ORDER` (`src/lib/calc-engine.ts`) are deliberately separate from `agingBucket` (used on `/qc-operations`'s property directory) rather than reusing/editing its boundaries — the Rollout Timeline page needed its own breakdown (0-8 / 8-10 / 10-13 / 13+ years), and changing `agingBucket` directly would have silently changed the aging label already shown elsewhere. Brownfield properties with no Opening Year (`rolloutPhaseBucket` returns `null`) aren't placed in any phase — `unclassifiedBrownfield` in the response reports the count; it's 0 for real IHCL data today, since every Brownfield row has an Opening Year.
- `properties.icp_model` (used by the Dashboard's ICP filter) is real, from the Properties sheet's "ICP FIT" column — only two values exist in real data: `Outsourcing` and `OPL`. Like `capex_deployed` and `carbon_saving_kg`, it wasn't captured by the parser until added, so getting a real value into already-committed properties required the same re-upload-to-backfill step.
- Two filters the user asked for aren't in this panel: **Tier** (a Luxury/Premium/etc. brand classification) has no source anywhere — not a column in any uploaded sheet, not derivable from Property/Brand data — and the user chose to skip it rather than have me either fabricate a mapping or guess IHCL's public brand positioning. **Timeline** is shown as a static "Yearly" label, not a working dropdown — every metric in this app is an annual figure; there's no monthly/quarterly data to switch to.
- `properties.capex_deployed` and `properties.carbon_saving_kg` (used by `savings-analysis`'s CAPEX and CO2 Savings cards) are both real, direct columns from the Properties sheet ("Capex to be deployed" / "Capex", and "Total CO2 Emission Savings (Yearly)" under that sheet's "CARBON SAVINGS" banner group) — populated straight from the upload (`src/lib/upload-parsers.ts`), not derived by comparing QC Average against Brand Average like Water/Energy/Cost are. The real IHCL source file's own banner-row totals for both columns (₹209.4 Cr Capex, 113,074,751 kg CO2) match our computed sums exactly, confirming the column mapping. `client_group_benchmarks.co2e_factor_per_kg_linen` (only a `SAMPLE` placeholder, no real parent group, no Settings UI) is unrelated and unused now that a real per-property CO2 figure exists directly in the source data.
- **Properties uploads don't archive raw rows** (unlike QC Average/Brand Average/Data Validation) — only whatever columns `PROPERTIES_HEADER_MAP` maps get stored; anything else in the sheet is silently dropped at parse time and unrecoverable from already-committed data. `carbon_saving_kg` was added after 484 IHCL properties were already committed with the old parser, so getting a real (non-zero) value into the database required re-uploading the same Properties/Brand File through `POST /api/uploads` + `/commit` — safe here since it's the same source data (upsert by `(brand_id, sr_no)`), not new data.
- `src/lib/calc-engine.ts` computes linen load using `room_load_benchmarks` (parent-group-specific row if one exists, else the seeded `GLOBAL` row) × room count, at an **explicit, documented 100% occupancy assumption** — real occupancy lives in `client_group_benchmarks.avg_occupancy`, which isn't populated for any real parent group yet (no Settings UI exists to enter it). This is a genuine number derived from real configured rates, not a fabricated one, but it's not occupancy-adjusted; every place it's surfaced says so.
- Not yet built: Settings UI for `client_group_benchmarks` (blocks Water/Energy/Cost/Savings and occupancy-adjusted Load everywhere), map & proximity leads, hardening (rest of Phases 3–5 of the design doc).
