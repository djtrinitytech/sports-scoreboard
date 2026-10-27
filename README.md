# Vyuha

Vyuha is a mobile-first live scoreboard and Max Showdown panna leaderboard, presented with Trinity branding. The public board reads groups, teams, match scores, and competition entries from Supabase. Admins update scores; Super Admin can directly correct match data, finalized results, and Max Showdown entries. There are no usernames or signup screens.

## Supabase setup

1. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the public scoreboard. The publishable key is browser-visible and protected by RLS.
2. Apply the SQL files in `supabase/migrations` in order using the Supabase Dashboard SQL Editor (or `supabase db push` if you use the CLI). Migration 002 imports the official teams and group-stage fixtures; migration 004 creates the Max Showdown leaderboard; migration 005 enables Super Admin match corrections; migration 006 adds cards and fair-play fields for the points table.
3. Configure these server-only variables in Vercel Project Settings → Environment Variables, and in local `.env.local` for development: `SUPABASE_SECRET_KEY`, `ADMIN_PASSCODE`, and `SUPER_ADMIN_PASSCODE`. Never prefix these values with `VITE_` or expose them to browser code. The Supabase secret key bypasses RLS and must remain on the server.
4. Install dependencies and run `npm run dev` for local development. Vite loads `.env.local` for its local `/api/admin-panel` middleware; production uses the same handler as a Vercel Function. No Supabase CLI or Edge Function deployment is required.

## Deploy to Vercel

1. Import `djtrinitytech/sports-scoreboard` in Vercel and keep the project root set to the repository root.
2. Use the Vite framework preset, build command `npm run build`, and output directory `dist`.
3. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEY`, `ADMIN_PASSCODE`, and `SUPER_ADMIN_PASSCODE` under the Vercel project's Environment Variables. Mark the latter three server-only by keeping them unprefixed with `VITE_`.
4. Apply the SQL migrations through Supabase Dashboard → SQL Editor. Vercel hosts the admin API; Supabase remains the database and realtime service.
5. Redeploy after adding or changing environment variables. The included `vercel.json` sends client-side routes to the Vite app entry point so direct links and refreshes work.

## Access and synchronization

- Admin signs in with the admin passcode. Super admin signs in with the separate super-admin passcode. Both passcodes are checked on the server; they are not bundled into the website. Failed attempts are rate-limited by IP.
- Every score change and fixture creation is checked by the Vercel serverless API and a server-only SQL function. Public browser clients have no write access. Score operations use unique operation IDs and optimistic match versions to prevent duplicate or conflicting updates.
- Max Showdown results are publicly readable. Adding entries requires Admin access; only Super Admin can correct or remove an entry. Super Admin can directly set both match scores and edit the teams, status, day, kickoff, venue, and stage.
- The first public tab is the group points table. It derives played, wins, draws, losses, goals, points, last-five form, card totals and fair-play scores from Supabase. Super Admins enter per-match card totals and fair-play points in the match correction form. FIFA-style head-to-head details are expandable. The schedule does not specify advancement rules, so the table shows top-two places and does not claim teams have qualified.
- Realtime updates the public scoreboard. Use Refresh when Realtime is unavailable. The status only shows Synced after a successful server response; it reports Pending Sync while a change is awaiting confirmation and Sync Failed when the server rejects or cannot confirm it.
- Configure HTTPS for the deployed Vercel site. This is a standard website with no PWA manifest, service worker, install prompt, or installation cache.

## Deployment checks

- Confirm 16 official teams and 24 group fixtures display after migrations 001-003.
- Confirm public clients can read matches and teams but cannot write them.
- Confirm the admin passcode can update scores and cannot edit a finalized match.
- Confirm the super-admin passcode can correct final scores, reopen a match, and add a same-group fixture.
- Confirm the Max Showdown tab lists entries, admins can add a name and score, and only Super Admin can edit or remove entries.
- Confirm the Points Table is the first tab, calculates from final group matches, applies head-to-head and overall goal criteria, and updates after match edits/realtime refresh.
- Confirm only Super Admin can edit match card totals and fair-play points, while public visitors can read standings.
- Confirm wrong passcodes are rejected and throttled; stale match versions are rejected and the latest server score remains visible.
