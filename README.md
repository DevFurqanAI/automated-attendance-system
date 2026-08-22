# Multi-Branch Staff Attendance System

Internal attendance tracking for a company with three branches. Staff check in
and out by scanning the QR code at a branch entrance while the app confirms
their GPS position; HR reviews anything the system flags, approves off-site work
requests, and exports monthly reports.

Runs entirely on **Next.js (App Router) + Supabase + Vercel** — no extra
servers or containers.

---

## Quick start

```bash
npm install
cp .env.example .env.local      # then fill in the three Supabase values
npm run dev
```

Full setup — including the database, which the app needs before it will do
anything useful — is below.

---

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the schema. Either paste the files into the dashboard **SQL Editor**
   in order, or — if you'd rather not use the editor — run them from here:

   ```bash
   # needs a personal access token from
   # https://supabase.com/dashboard/account/tokens
   # added to .env.local as SUPABASE_ACCESS_TOKEN=sbp_...
   npm run db:apply      # migrations + seed
   npm run db:verify     # asserts RLS, policies, realtime, grants, seed
   ```

   `db:apply` also accepts `SUPABASE_DB_URL` (the Postgres connection string
   from Dashboard → Connect) instead of a token, and `--no-seed` / `--file`.

   The files applied are:
   - `supabase/migrations/20260822090000_init.sql` — tables, RLS, realtime,
     and the trigger that creates an `employees` row for each new auth user.
   - `supabase/migrations/20260822120000_advisor_fixes.sql` — hardening raised
     by Supabase's own advisors.
   - `supabase/seed.sql` — the three branches. **Edit the coordinates first**;
     the ones in the file are placeholders.

   > The access token is only needed for schema changes. Once the schema is
   > applied you can delete it from `.env.local` and revoke it in the
   > dashboard — the app itself never uses it.

3. Copy your keys from **Project Settings → API** into `.env.local`:

   | Variable | Where it comes from | Exposed to browser |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL | yes |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable (or legacy `anon`) key | yes |
   | `SUPABASE_SERVICE_ROLE_KEY` | `service_role` / secret key | **never** |

   The service role key bypasses Row-Level Security completely. It is read only
   by server code (`createAdminClient()`), and it must never be given a
   `NEXT_PUBLIC_` prefix.

### Create the first HR administrator

Signing up gives you the `employee` role. There is deliberately no in-app way to
promote yourself, so the first admin is created out-of-band:

```bash
npm run db:bootstrap-admin -- you@yourcompany.com "Your Name"
```

It creates the auth user (email pre-confirmed, so no SMTP is needed), makes them
`hr_admin`, prints a generated password, and verifies sign-in and RLS actually
work. **Change that password after first sign-in.** Re-running it on an existing
account promotes without touching the password.

Or in SQL, if the account already exists:

```sql
update public.employees
   set role = 'hr_admin'
 where email = 'you@yourcompany.com';
```

Everyone after that can be promoted from **HR → Employees**.

---

## 2. Set up the branches and print the QR codes

1. Sign in as the HR admin and open **HR → Branches**.
2. For each branch, check the coordinates. Standing at the entrance and pressing
   **Use my current location** gives a far better geofence centre than a map
   pin does.
3. Press **Show QR code → Print** and mount the printout at the entrance.

A 100 m radius suits most sites. Setting it too tight is the most common cause
of honest staff being flagged.

**If a code is ever photographed and shared,** press **Rotate code** on that
branch. It issues a new secret, bumps the revision, and every previously printed
code for that branch stops verifying immediately — other branches are unaffected.

---

## 3. Deploy to Vercel

```bash
npm i -g vercel      # if not already installed
vercel link
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel --prod
```

Then in Supabase → **Authentication → URL Configuration**, set the Site URL to
your Vercel domain so invite and password-reset emails link to the right place.

> Camera and GPS both require a secure context. Vercel serves HTTPS, so this
> works in production; for local testing on a real phone use `next dev` behind
> an HTTPS tunnel, since `http://<your-lan-ip>:3000` will silently refuse the
> camera.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm test` | Unit tests (geofencing, QR tokens, claim window, CSV, spoofing checks) |
| `npm run lint` | ESLint |
| `npm run icons` | Regenerate PWA icons from `public/icon-512.png` |
| `npm run db:apply` | Apply migrations + seed to Supabase |
| `npm run db:verify` | Assert RLS, policies, grants, realtime and seed are correct |
| `npm run db:bootstrap-admin -- <email> [name]` | Create/promote the first HR admin |
| `npm run smoke -- <email> <password>` | End-to-end test against a running server |

`npm run smoke` signs in for real and asserts on every page, the QR image
endpoint, the CSV export, and — importantly — that a claim older than two days
is rejected server-side and that a pending claim never reaches a report.

---

## How it works

### Check-in requires two independent factors

1. **A signed QR token** proves *which branch* — it cannot be forged without
   that branch's secret.
2. **GPS inside the geofence** proves *presence* — the QR code is a static
   printout, so on its own it only proves someone once saw the code.

Both must pass for an automatic `approved`. If the QR token fails the request is
rejected outright (an unverifiable token names no branch, so there is nothing
meaningful to record). If the *location* factor fails, the check-in is still
**recorded** as `flagged` and queued for HR — never silently dropped.

### Where the QR signing secret lives

Per-branch, in `branches.qr_secret`, generated by the database on insert.

The spec offered a choice between one app-wide secret and per-branch secrets;
per-branch was chosen because it contains the blast radius. A compromised code
cannot be used to mint tokens for the other two branches, and any single branch
can be rotated without reprinting the others. The token also embeds
`qr_version`, so rotation invalidates old prints without needing an expiry —
which a printed code cannot have.

There is therefore **no app-wide QR signing secret** and no corresponding
environment variable.

### Spoofing detection (`src/lib/attendance/detect.ts`)

Every check-in and check-out runs four server-side checks, in severity order:

| Check | Flag reason |
|---|---|
| Client reported a mock-location provider | `mock_location_detected` |
| GPS outside the branch geofence | `out_of_range` |
| Distance from the previous event implies impossible speed (>250 km/h) | `impossible_travel` |
| Identical coordinates repeated across ≥5 days | `coordinate_jitter` |

The geofence is widened by the device's own reported accuracy, capped at 50 m —
enough to stop a phone with a poor fix being punished, not enough for a spoofer
to claim their way in.

> ### ⚠️ Known limitation: mock-location detection is partial on the web
>
> The spec assumed the client could read an OS mock-location flag. That is true
> for **native** apps — Android exposes `Location.isFromMockProvider()`. It is
> **not available to a web app**: the W3C Geolocation API deliberately reports no
> provider metadata, and a PWA cannot reach the native call. Since the spec rules
> out native apps (§3), there is no way to obtain the real flag in this version.
>
> `src/lib/geolocation.ts` therefore reports the strongest signals a browser
> genuinely can observe — physically impossible accuracy figures, and several
> byte-identical consecutive fixes where real GNSS always drifts. These catch
> casual fake-GPS apps but not a determined attacker.
>
> The controls that *cannot* be bypassed by a modified client are the
> server-side ones: the geofence, impossible-travel, and cross-day jitter checks
> above. If OS-level certainty is later required, the path is a thin native
> wrapper (Capacitor or a Trusted Web Activity) posting the real `isMock` flag
> into the same existing API field — no schema or API change needed.

### Remote check-in

A remote request is stored with `status = 'pending'` and the staff member's
*claimed* times in `claimed_check_in_time` / `claimed_check_out_time`. The
verified `check_in_time` / `check_out_time` columns stay `NULL` until HR
approves, at which point the claim is promoted into them (HR may correct it
first).

Because reports filter on `status = 'approved'` **and** read only the verified
columns, an unapproved claim cannot reach a total by either route.

The 2-day claim limit is enforced in `src/lib/attendance/remote-claim.ts`, called
from the API route. The form's `min`/`max` attributes are a convenience only and
are assumed to be bypassable.

### Security model

- RLS is enabled on every table. Staff can read and insert only their own
  attendance; only HR can update rows or manage branches and employees.
- Role checks go through `private.is_hr_admin()`, a `SECURITY DEFINER` function
  in an unexposed schema. This is necessary because an RLS policy on `employees`
  cannot itself select from `employees` without recursing. `EXECUTE` is revoked
  from `PUBLIC` and granted only to `authenticated`.
- Roles live in `public.employees.role`, never in `auth.users.raw_user_meta_data`
  — user metadata is user-editable and unsafe for authorization.
- `branches.qr_secret` is unreadable by staff at the column-grant level; the app
  reads branch data through the `branches_public` view.
- CSV exports escape leading `=`, `+`, `-`, and `@` so a crafted "remote reason"
  cannot execute as a formula when HR opens the file in Excel.

---

## Project layout

```
src/
  app/
    (app)/            signed-in pages (shared header, role-gated nav)
      check-in/       QR + GPS scan flow
      remote/         remote request form
      history/        staff's own records
      hr/             review dashboard (realtime), branches, employees, reports
    api/
      attendance/     check-in, check-out, remote  — all business logic
      hr/             review, branches + QR images, employees, CSV export
    login/
  components/         Logo, AppHeader, StatusBadge, QrScanner
  lib/
    attendance/       detect.ts (spoofing), remote-claim.ts, report.ts
    supabase/         browser client, server client, admin client, session
    geo.ts            Haversine + speed maths
    geolocation.ts    client GPS capture and browser-side spoof signals
    qr-token.ts       HMAC sign/verify for branch tokens
  proxy.ts            session refresh + auth gate (Next 16's former middleware)
supabase/
  migrations/         schema, RLS, realtime, triggers
  seed.sql            the three branches
tests/                unit tests for the pure logic
```

---

## Design and theme

Brand colours come from the supplied logo and are defined once as Tailwind v4
theme tokens in `src/app/globals.css` — `brand.primary` (`#4A7C8C`),
`brand.secondary` (`#0B0E10`), plus separate `status-*` tokens so a colour never
means two different things. Components reference tokens; none hardcode a hex.

> Tailwind v4 configures the theme in CSS via `@theme` rather than a
> `tailwind.config.js` file. The `@theme` block **is** the theme config the spec
> asks for; there is no separate config file to edit.

Flat design throughout: no gradients, no shadows, square corners, white surface,
system sans-serif.

---

## Not built (deliberately)

- **Selfie capture.** `selfie_url` exists in the schema and is left unused, per
  spec §8. Adding it later needs a Storage bucket and UI, no schema change.
- **Payroll integration.** Out of scope; the CSV export is the handoff.
- **Native apps.** The PWA is installable to a home screen instead.
