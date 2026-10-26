# Touchline

Touchline is a mobile-first live scoreboard for the official four-group tournament schedule. The public board reads groups, teams and match scores from Supabase. Admins update scores; the super-admin passcode can also correct final scores, reopen matches, and add fixtures. There are no usernames or signup screens.

## Supabase setup

1. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` for local development and in Vercel for deployment. The browser key is publishable; never put a Supabase secret/service-role key in a `VITE_` variable.
2. Apply the database migrations in order with `supabase db push`. Migration 002 imports the 16 official teams and 24 group-stage fixtures. The schedule provides Day 1/Day 2 and kickoff times but no calendar dates, so the site does not invent dates.
3. Store the two passcodes as server-side Supabase Function secrets. Do not add their values to the repository, `.env.local`, or Vercel browser variables:

   ```sh
   supabase secrets set ADMIN_PASSCODE="<admin passcode>" SUPER_ADMIN_PASSCODE="<super admin passcode>" --project-ref nteearzxgqwbtwmyttud
   ```

4. Deploy the password-checking Edge Function:

   ```sh
   supabase functions deploy admin-panel --project-ref nteearzxgqwbtwmyttud
   ```

   The function uses Supabase's server-side `SUPABASE_SERVICE_ROLE_KEY` runtime secret. Only the function receives that credential. Migration 003 grants its database RPCs to `service_role` only.
5. Install dependencies and start Vite with `npm install` and `npm run dev`. Vite serves the website; the Supabase Edge Function must be deployed for admin passcodes and score changes.

## Deploy to Vercel

1. Import `djtrinitytech/sports-scoreboard` in Vercel and keep the project root set to the repository root.
2. Use the Vite framework preset, build command `npm run build`, and output directory `dist` (Vercel can also detect these from the project).
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under the Vercel project's Environment Variables for the environments you deploy. Use the Supabase project URL and publishable/anon key. These `VITE_` values are public browser configuration; never add a Supabase secret/service-role key or either passcode here.
4. Deploy the database migrations and `admin-panel` Edge Function to Supabase as described above, with `ADMIN_PASSCODE` and `SUPER_ADMIN_PASSCODE` configured as Supabase Function secrets.
5. Redeploy after adding or changing environment variables. The included `vercel.json` sends client-side routes to the Vite app entry point so direct links and refreshes work.

## Access and synchronization

- Admin signs in with the admin passcode. Super admin signs in with the separate super-admin passcode. Both passcodes are checked on the server; they are not bundled into the website. Failed attempts are rate-limited by IP.
- Every score change and fixture creation is checked by the Edge Function and a server-only SQL function. Public browser clients have no write access. Score operations use unique operation IDs and optimistic match versions to prevent duplicate or conflicting updates.
- Realtime updates the public scoreboard. Use Refresh when Realtime is unavailable. The status only shows Synced after a successful server response; it reports Pending Sync while a change is awaiting confirmation and Sync Failed when the server rejects or cannot confirm it.
- Configure HTTPS for the deployed Vercel site. This is a standard website with no PWA manifest, service worker, install prompt, or installation cache.

## Deployment checks

- Confirm 16 official teams and 24 group fixtures display after migrations 001-003.
- Confirm public clients can read matches and teams but cannot write them.
- Confirm the admin passcode can update scores and cannot edit a finalized match.
- Confirm the super-admin passcode can correct final scores, reopen a match, and add a same-group fixture.
- Confirm wrong passcodes are rejected and throttled; stale match versions are rejected and the latest server score remains visible.
