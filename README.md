# Fantasy Keeper HQ

Fantasy Keeper HQ is a phased full-stack web app for running a multi-sport fantasy keeper league. Phase 1 is fully wired for a live draft board, roster validations, owner views, commissioner/admin tools, and spreadsheet-friendly import/export. Phase 2 and Phase 3 foundations are scaffolded through provider abstractions and a private draft workspace.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Prisma
- PostgreSQL via Prisma, ready for hosted deployment on platforms like Supabase + Vercel

## Phase 1 Included

- Live snake draft board with current pick, next owner, undo support, duplicate prevention, and near-real-time polling
- Traded pick ownership overrides on top of default slot ownership
- Keeper support that counts toward roster totals
- Owner dashboard with per-sport and total roster validation states
- Owner list and owner detail pages with grouped rosters
- Admin tools for roster limits, traded picks, keepers, owner codes, spreadsheet import, export, and reseeding
- Structured import adapter that parses spreadsheet-style values such as `(ME) ⚾️ Player Name`
- Google Sheets source-of-truth sync for `Draft View` and `Roster Limits`, plus webhook-based draft-pick writeback scaffolding

## Scaffolded For Later Phases

- Provider abstraction for `ESPNProvider`, `CSVImportProvider`, and `ManualEntryProvider`
- Private rankings, watchlist, and strategy workspace data model and starter UI
- Integration source and imported record tracking

## Local Setup

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` and `DIRECT_URL` to your PostgreSQL connection strings.
3. Run `pnpm prisma:generate`.
4. Run `pnpm exec prisma db push`.
5. Run `pnpm db:seed`.
6. Run `pnpm dev`.

For Supabase, use:

- `DATABASE_URL`: the `Session pooler` connection string
- `DIRECT_URL`: the `Direct connection` string

They usually look like:

```bash
DATABASE_URL="postgresql://...pooler.supabase.com:5432/postgres?sslmode=require"
DIRECT_URL="postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT_REF.supabase.co:5432/postgres?sslmode=require"
```

Optional integration settings:

- `KEEPER_GOOGLE_SHEET_URL`: default keeper sheet URL used by the admin Google Sheet sync tools
- `GOOGLE_SHEETS_WRITEBACK_WEBHOOK_URL`: optional webhook endpoint for pushing draft picks back out as they happen

## Public Deployment

Recommended starter setup:

- App hosting: `Vercel`
- Database: `Supabase Postgres`

Basic deployment flow:

1. Create a hosted Postgres database in Supabase.
2. Set `DATABASE_URL` and `DIRECT_URL` locally and in Vercel project environment variables.
3. Run `pnpm prisma:generate`.
4. Run `pnpm exec prisma db push`.
5. Run `pnpm db:seed`.
6. Import the repo into Vercel and deploy.

If the database password was ever shared while setting this up, rotate it in Supabase before production use.

If your shell does not have `node` on `PATH`, this project already pins the scripts to the bundled Codex Node runtime, so `pnpm dev` should still work.

If Prisma engines were previously blocked by your package manager security settings, allow them and rerun `pnpm prisma:generate`.
This project pins the dev/build scripts to Next's SWC WASM package so it can run cleanly in environments where native Next binaries are unavailable.

## Demo Notes

- Seed data includes all 10 owners, owner codes, roster limits, keeper examples, traded picks, sample drafted players, private rankings, watchlist entries, and a strategy profile.
- The app redirects `/` to `/draft`.
- Export is available at `/api/export`.
- Admin reset/reseed is available from `/admin`.
- Google Sheet sync can be configured from `/admin`. The app currently treats `Draft View` as the keeper/traded-pick setup source and `Roster Limits` as the roster-size source.
- Live writeback is webhook-based so you can connect Google Apps Script or another sheet-updater service once the app is deployed on a public URL.

## Project Structure

- `prisma/schema.prisma`: domain schema
- `prisma/seed.ts`: realistic 10-owner demo seed
- `lib/draft`: draft and roster business logic
- `lib/import`: spreadsheet import adapters
- `lib/providers`: Phase 2 integration abstraction
- `components/private`: Phase 3 private workspace scaffold
- `tests`: unit-testable helper coverage
