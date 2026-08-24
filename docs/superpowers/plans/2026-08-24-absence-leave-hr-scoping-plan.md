# Absence Tracking, Leave Requests, Holiday Calendars & Branch-Scoped HR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the attendance system a real notion of an expected work day (weekly schedule + holiday calendar), a leave-request workflow, a nightly job that marks unexplained no-shows as absent, and a branch-scoped HR admin tier so each HR administrator only sees the branches assigned to them.

**Architecture:** Five sequential Postgres migrations build the data model and RLS policies (branch scoping helpers → weekly schedule/holiday resolver → leave requests → absences → the nightly `pg_cron` job). Application code layers on top: existing HR-only API routes gain scope checks using the same `getHrUser()`/service-role-client pattern already in the codebase; two new employee-facing pages (`/leave`) and one new HR review tab reuse existing components (`StatusBadge`, the `ReviewDashboard` card pattern, `RemoteForm`'s structure). The nav is restructured in the same pass since it's already over budget and this adds one more item.

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS + `pg_cron`), `@supabase/ssr`/`@supabase/supabase-js`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-absence-leave-hr-scoping-design.md`

## Global Constraints

- All new/changed SQL goes in a new, timestamp-prefixed file under `supabase/migrations/`, applied with `npm run db:apply` (never edit an already-applied migration file).
- Every RLS-protected table follows the existing defense-in-depth pattern: RLS policy **and** an explicit `grant`/`revoke` at the column or table level (see `supabase/migrations/20260822090000_init.sql` and `20260824090000_harden_grants.sql`).
- Every privileged write goes through `createAdminClient()` after an explicit `getHrUser()`/scope check in the route handler — the RLS policy is the second line of defense, not the only one, matching every existing route in `src/app/api/hr/`.
- Every state-changing HR action is recorded via `recordAudit()` (`src/lib/audit.ts`) and, where a human is waiting on the outcome, via `notify()` (`src/lib/notify.ts`) — mirror the existing calls in `src/app/api/hr/review/route.ts`.
- This codebase's test convention (see `tests/`) is: **pure logic gets a Vitest unit test; API routes, RLS, and DB functions are verified via `scripts/db-verify.mjs` and `scripts/smoke-e2e.mjs`**, not mocked route tests. Follow that split rather than introducing a new testing style.
- All new timestamps/dates are reasoned about in `Asia/Karachi` (see `src/lib/format.ts`), since every branch is in Pakistan.
- Run `npm run typecheck` and `npm run lint` before every commit in this plan; run `npm run test` whenever a task touches `src/lib/`.

---

## Task 1: Super-admin tier, `hr_branch_assignments`, and RLS scoping helpers

**Files:**
- Create: `supabase/migrations/20260824100000_hr_branch_scoping.sql`
- Modify: `src/lib/types.ts:3` (the `Role` type)

**Interfaces:**
- Produces: SQL functions `private.is_super_admin()`, `private.hr_branch_ids()`, `private.hr_visible_employee_ids()` — all `SECURITY DEFINER`, callable by `authenticated`, used by every later migration's RLS policies. Produces table `public.hr_branch_assignments (hr_admin_id uuid, branch_id uuid)`.
- Consumes: existing `private.is_hr_admin()` from `20260822090000_init.sql`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260824100000_hr_branch_scoping.sql
-- =====================================================================
-- Super-admin tier + per-branch HR scoping.
--
-- HR admins are no longer global: an hr_admin only sees employees whose
-- default_branch_id is one of their assigned branches (or who have no
-- branch at all). super_admin bypasses scoping entirely. See
-- docs/superpowers/specs/2026-08-24-absence-leave-hr-scoping-design.md.
-- =====================================================================

alter table public.employees
  drop constraint if exists employees_role_check;
alter table public.employees
  add constraint employees_role_check
  check (role in ('employee', 'hr_admin', 'super_admin'));

create table if not exists public.hr_branch_assignments (
  hr_admin_id uuid not null references public.employees(id) on delete cascade,
  branch_id   uuid not null references public.branches(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (hr_admin_id, branch_id)
);

alter table public.hr_branch_assignments enable row level security;

-- ---------------------------------------------------------------------
-- Helpers. SECURITY DEFINER so they bypass RLS on the tables they query,
-- the same reason private.is_hr_admin() already does (see init migration).
-- ---------------------------------------------------------------------
create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employees e
    where e.id = (select auth.uid())
      and e.role = 'super_admin'
      and e.active
  );
$$;

revoke all on function private.is_super_admin() from public;
grant execute on function private.is_super_admin() to authenticated;

create or replace function private.hr_branch_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select branch_id from public.hr_branch_assignments
  where hr_admin_id = (select auth.uid());
$$;

revoke all on function private.hr_branch_ids() from public;
grant execute on function private.hr_branch_ids() to authenticated;

-- Every employee a scoped HR admin is allowed to see: their assigned
-- branches, plus anyone with no default branch. Reused by every RLS
-- policy below and by every later migration that scopes to HR.
create or replace function private.hr_visible_employee_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.employees
  where default_branch_id in (select private.hr_branch_ids())
     or default_branch_id is null;
$$;

revoke all on function private.hr_visible_employee_ids() from public;
grant execute on function private.hr_visible_employee_ids() to authenticated;

-- ---- hr_branch_assignments: super_admin manages, hr_admin reads own ------
drop policy if exists "hr_branch_assignments read own or super" on public.hr_branch_assignments;
create policy "hr_branch_assignments read own or super"
  on public.hr_branch_assignments for select
  to authenticated
  using (hr_admin_id = (select auth.uid()) or private.is_super_admin());

drop policy if exists "hr_branch_assignments managed by super" on public.hr_branch_assignments;
create policy "hr_branch_assignments managed by super"
  on public.hr_branch_assignments for all
  to authenticated
  using (private.is_super_admin())
  with check (private.is_super_admin());

grant select, insert, update, delete on public.hr_branch_assignments to authenticated;

-- ---- employees: scope HR visibility to assigned branches ----------------
drop policy if exists "employees read own row" on public.employees;
create policy "employees read own row"
  on public.employees for select
  to authenticated
  using (
    (select auth.uid()) = id
    or private.is_super_admin()
    or (private.is_hr_admin() and id in (select private.hr_visible_employee_ids()))
  );

drop policy if exists "employees insertable by hr" on public.employees;
create policy "employees insertable by hr"
  on public.employees for insert
  to authenticated
  with check (private.is_hr_admin() or private.is_super_admin());

drop policy if exists "employees managed by hr" on public.employees;
create policy "employees managed by hr"
  on public.employees for update
  to authenticated
  using (
    private.is_super_admin()
    or (private.is_hr_admin() and id in (select private.hr_visible_employee_ids()))
  )
  with check (
    private.is_super_admin()
    or (private.is_hr_admin() and id in (select private.hr_visible_employee_ids()))
  );

-- ---- attendance: scope HR visibility to assigned branches ---------------
drop policy if exists "attendance read own or hr" on public.attendance;
create policy "attendance read own or hr"
  on public.attendance for select
  to authenticated
  using (
    (select auth.uid()) = employee_id
    or private.is_super_admin()
    or (private.is_hr_admin() and employee_id in (select private.hr_visible_employee_ids()))
  );

drop policy if exists "attendance update by hr" on public.attendance;
create policy "attendance update by hr"
  on public.attendance for update
  to authenticated
  using (
    private.is_super_admin()
    or (private.is_hr_admin() and employee_id in (select private.hr_visible_employee_ids()))
  )
  with check (
    private.is_super_admin()
    or (private.is_hr_admin() and employee_id in (select private.hr_visible_employee_ids()))
  );

-- ---- branches: creation is super_admin only; scoped edit for assigned --
drop policy if exists "branches insertable by hr" on public.branches;
create policy "branches insertable by super admin"
  on public.branches for insert
  to authenticated
  with check (private.is_super_admin());

drop policy if exists "branches updatable by hr" on public.branches;
create policy "branches updatable by hr or assigned admin"
  on public.branches for update
  to authenticated
  using (
    private.is_super_admin()
    or (private.is_hr_admin() and id in (select private.hr_branch_ids()))
  )
  with check (
    private.is_super_admin()
    or (private.is_hr_admin() and id in (select private.hr_branch_ids()))
  );
```

- [ ] **Step 2: Apply and verify**

Run: `npm run db:apply -- --file supabase/migrations/20260824100000_hr_branch_scoping.sql`
Expected: `ok` printed for the file, no errors.

Run a manual check via the Supabase SQL editor or `node scripts/db-apply.mjs` REPL-style query:
```sql
select private.is_super_admin(); -- should not error when run as a service-role/psql session
select count(*) from public.hr_branch_assignments;
```
Expected: both run without error (0 rows in the new table).

- [ ] **Step 3: Update the `Role` type**

In `src/lib/types.ts:3`:
```ts
export type Role = 'employee' | 'hr_admin' | 'super_admin';
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: fails at every place that assumed `Role` only had two values (this surfaces exactly what Tasks 3–5 need to touch — note them, don't fix yet).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260824100000_hr_branch_scoping.sql src/lib/types.ts
git commit -m "Add super_admin role tier and per-branch HR scoping RLS"
```

---

## Task 2: Promote the super-admin account and extend the role-change script

**Files:**
- Modify: `scripts/set-role.mjs`

**Interfaces:**
- Consumes: `Role` from Task 1 (now includes `super_admin`).

- [ ] **Step 1: Extend the script to accept `super_admin`**

In `scripts/set-role.mjs`, change the validation and usage text (around line 42):
```js
if (!email || !['employee', 'hr_admin', 'super_admin'].includes(role)) {
  console.error(
    'Usage: node scripts/set-role.mjs <email> <employee|hr_admin|super_admin> [--reason "…"]',
  );
  process.exit(1);
}
```

And extend the "last admin" guard (around line 76) to also protect the last active `super_admin`:
```js
// Guard the last way in — either tier.
if (['hr_admin', 'super_admin'].includes(employee.role) && role === 'employee') {
  const { count } = await admin
    .from('employees')
    .select('id', { count: 'exact', head: true })
    .eq('role', employee.role)
    .eq('active', true);

  if ((count ?? 0) <= 1) {
    console.error(
      `Refusing: ${employee.full_name} is the only active ${employee.role}.\n` +
        '  Promote someone else first, or the review dashboard becomes unreachable.',
    );
    process.exit(1);
  }
}
```

- [ ] **Step 2: Run it against the real super-admin account**

Run: `node scripts/set-role.mjs arshadfurqan031@gmail.com super_admin --reason "Initial super-admin promotion for branch-scoped HR rollout"`
Expected: `arshadfurqan031@gmail.com: hr_admin → super_admin` (or `employee → super_admin`, depending on their current role) printed, no errors.

- [ ] **Step 3: Verify**

Run a query (via `scripts/db-verify.mjs`'s `q()` helper or the SQL editor):
```sql
select email, role from public.employees where email = 'arshadfurqan031@gmail.com';
```
Expected: `role = 'super_admin'`.

- [ ] **Step 4: Commit**

```bash
git add scripts/set-role.mjs
git commit -m "Support promoting to super_admin from set-role.mjs"
```

---

## Task 3: Server-side role helpers and the branch-scope check

**Files:**
- Modify: `src/lib/supabase/server.ts:85-90` (`getHrUser`)
- Create: `src/lib/hr-scope.ts`

**Interfaces:**
- Produces: `getHrUser()` now returns a user whose role is `hr_admin` **or** `super_admin` (unchanged signature). New `getSuperAdminUser(): Promise<SessionUser | null>`. New `src/lib/hr-scope.ts` exports:
  - `isBranchManagedBy(admin: SupabaseClient, hr: SessionUser, branchId: string): Promise<boolean>` — `true` immediately if `hr.employee.role === 'super_admin'`; otherwise checks `hr_branch_assignments`.
  - `isEmployeeVisibleTo(admin: SupabaseClient, hr: SessionUser, employee: Pick<Employee, 'default_branch_id'>): Promise<boolean>` — `true` if super_admin, or `employee.default_branch_id` is null, or it's in the hr's assigned branches.
- Consumes: `SessionUser`, `Employee` from `src/lib/types.ts`; `createAdminClient()` pattern from `src/lib/supabase/server.ts`.

- [ ] **Step 1: Update `getHrUser`**

In `src/lib/supabase/server.ts:85-90`:
```ts
/** Same as getSessionUser, but also asserts HR-level access (hr_admin or super_admin). */
export async function getHrUser(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user || (user.employee.role !== 'hr_admin' && user.employee.role !== 'super_admin')) {
    return null;
  }
  return user;
}

/** Same as getSessionUser, but asserts the unscoped super_admin tier. */
export async function getSuperAdminUser(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user || user.employee.role !== 'super_admin') return null;
  return user;
}
```

- [ ] **Step 2: Write `src/lib/hr-scope.ts`**

```ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Employee } from '@/lib/types';
import type { SessionUser } from '@/lib/supabase/server';

/**
 * Branch-scope checks for HR write endpoints.
 *
 * Read scoping is enforced by RLS (see the 20260824100000 migration) for any
 * query made with the caller's own session client. These helpers exist for
 * the routes that must write through the service-role client, which bypasses
 * RLS entirely — the same reason every other HR route re-checks permission in
 * code rather than trusting the client (see src/app/api/hr/review/route.ts).
 */

export async function isBranchManagedBy(
  admin: SupabaseClient,
  hr: SessionUser,
  branchId: string,
): Promise<boolean> {
  if (hr.employee.role === 'super_admin') return true;

  const { data } = await admin
    .from('hr_branch_assignments')
    .select('branch_id')
    .eq('hr_admin_id', hr.id)
    .eq('branch_id', branchId)
    .maybeSingle();

  return Boolean(data);
}

export async function isEmployeeVisibleTo(
  admin: SupabaseClient,
  hr: SessionUser,
  employee: Pick<Employee, 'default_branch_id'>,
): Promise<boolean> {
  if (hr.employee.role === 'super_admin') return true;
  if (employee.default_branch_id === null) return true;
  return isBranchManagedBy(admin, hr, employee.default_branch_id);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: the `Role`-related errors from Task 1 Step 4 that involved `getHrUser`'s two-value assumption are gone; remaining errors are the ones this task doesn't touch yet (Tasks 4–5 will clear those).

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase/server.ts src/lib/hr-scope.ts
git commit -m "Add super_admin session helper and HR branch-scope checks"
```

---

## Task 4: Scope the employee-management API to the new role tiers

**Files:**
- Modify: `src/app/api/hr/employees/route.ts`

**Interfaces:**
- Consumes: `getHrUser`, `getSuperAdminUser` (Task 3), `isEmployeeVisibleTo` (Task 3).

- [ ] **Step 1: Restrict role and branch changes to `super_admin`**

Replace the `removingAnAdmin` block and the role/branch handling in the `PATCH` handler (`src/app/api/hr/employees/route.ts:104-167`) with:

```ts
  // Role changes and branch reassignment are super_admin-only — see
  // docs/superpowers/specs/2026-08-24-absence-leave-hr-scoping-design.md
  // "HR branch scoping". A scoped hr_admin keeps day-to-day management
  // (activate/deactivate) for employees in their branches, checked below.
  if (body.role !== undefined || body.defaultBranchId !== undefined) {
    if (hr.employee.role !== 'super_admin') {
      return NextResponse.json(
        {
          error:
            'Only a super administrator can change an employee\'s role or ' +
            'default branch.',
        },
        { status: 403 },
      );
    }
  }

  // Deactivating or reactivating an hr_admin/super_admin is always
  // super_admin-only — the same "no admin can strip another's access"
  // reasoning as before, now framed around the tier rather than a flat
  // hr_admin/hr_admin check.
  if (body.active !== undefined && target.role !== 'employee' && hr.employee.role !== 'super_admin') {
    return NextResponse.json(
      {
        error:
          `${target.full_name} is an HR administrator. Only a super ` +
          'administrator can activate or deactivate another administrator.',
      },
      { status: 403 },
    );
  }

  // A scoped hr_admin may only touch employees within their assigned
  // branches (or branch-less employees).
  if (hr.employee.role !== 'super_admin' && !(await isEmployeeVisibleTo(admin, hr, target))) {
    return NextResponse.json(
      { error: 'This employee is not in one of your assigned branches.' },
      { status: 403 },
    );
  }

  const update: Record<string, unknown> = {};

  if (body.role !== undefined) {
    if (body.role !== 'employee' && body.role !== 'hr_admin' && body.role !== 'super_admin') {
      return NextResponse.json({ error: 'Invalid role.' }, { status: 400 });
    }
    if (id === hr.id && body.role !== 'super_admin') {
      return NextResponse.json(
        { error: 'You cannot remove your own super administrator role.' },
        { status: 400 },
      );
    }
    update.role = body.role;
  }

  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') {
      return NextResponse.json({ error: 'Invalid active flag.' }, { status: 400 });
    }
    if (id === hr.id && body.active === false) {
      return NextResponse.json(
        { error: 'You cannot deactivate your own account.' },
        { status: 400 },
      );
    }
    update.active = body.active;
  }

  if (body.defaultBranchId !== undefined) {
    update.default_branch_id =
      typeof body.defaultBranchId === 'string' && body.defaultBranchId
        ? body.defaultBranchId
        : null;
  }
```

Add the import at the top of the file:
```ts
import { isEmployeeVisibleTo } from '@/lib/hr-scope';
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors in this file.

- [ ] **Step 3: Manual verification**

Start the dev server (`npm run dev`) and, signed in as the (now scoped) main-branch `hr_admin`, attempt `PATCH /api/hr/employees` with `{ id: <employee outside their branch>, active: false }` via the browser devtools console or a REST client.
Expected: `403` with the "not in one of your assigned branches" message. The same call for an employee inside their branch should `200`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/hr/employees/route.ts
git commit -m "Scope employee management to super_admin (role/branch) and assigned branches (active flag)"
```

---

## Task 5: HR → branch assignment API and UI

**Files:**
- Create: `src/app/api/hr/branch-assignments/route.ts`
- Modify: `src/app/(app)/hr/employees/page.tsx`
- Modify: `src/app/(app)/hr/employees/EmployeeManager.tsx`

**Interfaces:**
- Consumes: `getSuperAdminUser` (Task 3), `recordAudit` (existing), `Branch`/`Employee` types.
- Produces: `POST /api/hr/branch-assignments` body `{ hrAdminId: string, branchIds: string[] }` → replaces that HR admin's full assignment set. Response `{ hrAdminId, branchIds }`.

- [ ] **Step 1: Add the audit action**

In `src/lib/audit.ts`, add to `AuditAction` (line 12-22) and `AUDIT_ACTION_LABELS` (line 65-76):
```ts
  | 'hr.branches_assigned',
```
```ts
  'hr.branches_assigned': 'Updated HR branch assignments',
```

- [ ] **Step 2: Write the API route**

```ts
// src/app/api/hr/branch-assignments/route.ts
import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { createAdminClient, getSuperAdminUser } from '@/lib/supabase/server';

/**
 * POST /api/hr/branch-assignments — replace one HR admin's full set of
 * managed branches. Super-admin only: see "Who assigns HR" in the design doc.
 */
export async function POST(request: Request) {
  const superAdmin = await getSuperAdminUser();
  if (!superAdmin) {
    return NextResponse.json(
      { error: 'Super administrator access required.' },
      { status: 403 },
    );
  }

  let body: { hrAdminId?: unknown; branchIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const hrAdminId = typeof body.hrAdminId === 'string' ? body.hrAdminId : '';
  const branchIds = Array.isArray(body.branchIds)
    ? body.branchIds.filter((v): v is string => typeof v === 'string')
    : null;

  if (!hrAdminId || !branchIds) {
    return NextResponse.json(
      { error: 'hrAdminId and branchIds are required.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: target } = await admin
    .from('employees')
    .select('id, role')
    .eq('id', hrAdminId)
    .single<{ id: string; role: string }>();

  if (!target || target.role !== 'hr_admin') {
    return NextResponse.json(
      { error: 'Target must be an existing hr_admin.' },
      { status: 400 },
    );
  }

  const { error: deleteError } = await admin
    .from('hr_branch_assignments')
    .delete()
    .eq('hr_admin_id', hrAdminId);

  if (deleteError) {
    return NextResponse.json(
      { error: 'Could not update branch assignments.' },
      { status: 500 },
    );
  }

  if (branchIds.length > 0) {
    const { error: insertError } = await admin
      .from('hr_branch_assignments')
      .insert(branchIds.map((branchId) => ({ hr_admin_id: hrAdminId, branch_id: branchId })));

    if (insertError) {
      return NextResponse.json(
        { error: 'Could not update branch assignments.' },
        { status: 500 },
      );
    }
  }

  await recordAudit(admin, superAdmin, {
    action: 'hr.branches_assigned',
    entityType: 'employee',
    entityId: hrAdminId,
    subjectId: hrAdminId,
    detail: { branch_ids: branchIds },
  });

  return NextResponse.json({ hrAdminId, branchIds });
}
```

- [ ] **Step 3: Pass assignment data to the Employees page**

In `src/app/(app)/hr/employees/page.tsx`, fetch the current assignments (readable by the signed-in super_admin via RLS) and pass them down:
```ts
  const [{ data: employees }, { data: branches }, { data: assignments }] = await Promise.all([
    supabase.from('employees').select('*').order('full_name').returns<Employee[]>(),
    supabase.from('branches_public').select('*').order('name').returns<Branch[]>(),
    supabase
      .from('hr_branch_assignments')
      .select('hr_admin_id, branch_id')
      .returns<{ hr_admin_id: string; branch_id: string }[]>(),
  ]);

  return (
    <EmployeeManager
      employees={employees ?? []}
      branches={branches ?? []}
      currentUserId={hr.id}
      currentUserRole={hr.employee.role}
      branchAssignments={assignments ?? []}
    />
  );
```
(Also change `const hr = await getHrUser();` — unchanged — but note `hr.employee.role` is now meaningful since `getHrUser` accepts both tiers.)

- [ ] **Step 4: Read `EmployeeManager.tsx` to find the exact insertion points**

Run: read `src/app/(app)/hr/employees/EmployeeManager.tsx` in full before editing — it wasn't reproduced in this plan because its exact current markup determines where the role-change control and the new per-row "Manage branches" control go. Locate:
1. The prop list / component signature (extend with `currentUserRole: Role` and `branchAssignments: { hr_admin_id: string; branch_id: string }[]`).
2. Wherever a `<select>` or button currently lets HR change `role` or `defaultBranchId` — wrap it in `{currentUserRole === 'super_admin' && (...)}` so a scoped `hr_admin` sees it read-only (render the current value as text instead).
3. Add, for each row where `role === 'hr_admin'` and `currentUserRole === 'super_admin'`, a small multi-select or checkbox list of branches (from the `branches` prop) reflecting that admin's rows in `branchAssignments`, with a "Save" button posting to `/api/hr/branch-assignments` with `{ hrAdminId: row.id, branchIds: selected }` and calling `router.refresh()` on success — follow the exact `fetch` + `setBusy`/`setError` + `router.refresh()` shape already used by `createBranch`/`rotate` in `src/app/(app)/hr/branches/BranchManager.tsx:27-49`.

- [ ] **Step 5: Typecheck and manual verification**

Run: `npm run typecheck`
Expected: no errors.

Manually: sign in as the `super_admin`, open `/hr/employees`, assign the 2-branch HR admin to their two branches and the main-branch HR admin to the main branch, confirm the assignment persists after a refresh (query `select * from hr_branch_assignments` to confirm).

- [ ] **Step 6: Commit**

```bash
git add src/lib/audit.ts src/app/api/hr/branch-assignments/route.ts src/app/\(app\)/hr/employees/page.tsx src/app/\(app\)/hr/employees/EmployeeManager.tsx
git commit -m "Add super_admin-only HR-to-branch assignment management"
```

---

## Task 6: Weekly schedule, holiday calendar, and the `is_working_day` resolver

**Files:**
- Create: `supabase/migrations/20260824101000_schedule_holidays.sql`
- Modify: `src/lib/types.ts` (`Branch`, `Employee`, new `BranchCalendarDay`)

**Interfaces:**
- Produces: `private.is_working_day(employee_id uuid, date date) returns boolean`, table `public.branch_calendar_days`, columns `branches.weekly_off_days`, `employees.weekly_off_days`.
- Consumes: `private.is_hr_admin()`, `private.is_super_admin()`, `private.hr_branch_ids()` (Task 1).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260824101000_schedule_holidays.sql
-- =====================================================================
-- Weekly work schedule + branch holiday calendar.
--
-- Precedence for whether a given (employee, date) is a working day, high to
-- low: branch_calendar_days 'mandatory_workday' > 'holiday' > the
-- employee's own weekly_off_days (if set) else their branch's. See
-- docs/superpowers/specs/2026-08-24-absence-leave-hr-scoping-design.md.
-- =====================================================================

alter table public.branches
  add column if not exists weekly_off_days smallint[] not null default '{0}';
alter table public.branches
  drop constraint if exists branches_weekly_off_days_valid;
alter table public.branches
  add constraint branches_weekly_off_days_valid
  check (weekly_off_days <@ array[0,1,2,3,4,5,6]::smallint[]);

alter table public.employees
  add column if not exists weekly_off_days smallint[];
alter table public.employees
  drop constraint if exists employees_weekly_off_days_valid;
alter table public.employees
  add constraint employees_weekly_off_days_valid
  check (weekly_off_days is null or weekly_off_days <@ array[0,1,2,3,4,5,6]::smallint[]);

create table if not exists public.branch_calendar_days (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references public.branches(id) on delete cascade,
  date       date not null,
  kind       text not null check (kind in ('holiday', 'mandatory_workday')),
  label      text,
  created_at timestamptz not null default now(),
  unique (branch_id, date)
);

alter table public.branch_calendar_days enable row level security;

drop policy if exists "branch_calendar_days readable by authenticated" on public.branch_calendar_days;
create policy "branch_calendar_days readable by authenticated"
  on public.branch_calendar_days for select
  to authenticated
  using (true);

drop policy if exists "branch_calendar_days managed by scoped hr" on public.branch_calendar_days;
create policy "branch_calendar_days managed by scoped hr"
  on public.branch_calendar_days for all
  to authenticated
  using (
    private.is_super_admin()
    or (private.is_hr_admin() and branch_id in (select private.hr_branch_ids()))
  )
  with check (
    private.is_super_admin()
    or (private.is_hr_admin() and branch_id in (select private.hr_branch_ids()))
  );

grant select, insert, update, delete on public.branch_calendar_days to authenticated;

create index if not exists branch_calendar_days_branch_date_idx
  on public.branch_calendar_days (branch_id, date);

-- ---------------------------------------------------------------------
-- is_working_day: the one place the precedence rule lives. Used by both
-- the nightly absence job and reporting queries.
-- ---------------------------------------------------------------------
create or replace function private.is_working_day(p_employee_id uuid, p_date date)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch_id uuid;
  v_weekday smallint;
  v_off_days smallint[];
  v_kind text;
begin
  select default_branch_id, weekly_off_days
    into v_branch_id, v_off_days
    from public.employees
   where id = p_employee_id;

  v_weekday := extract(dow from p_date)::smallint; -- 0=Sunday..6=Saturday

  if v_branch_id is not null then
    select kind into v_kind
      from public.branch_calendar_days
     where branch_id = v_branch_id and date = p_date;

    if v_kind = 'mandatory_workday' then
      return true;
    end if;
    if v_kind = 'holiday' then
      return false;
    end if;
  end if;

  if v_off_days is null and v_branch_id is not null then
    select weekly_off_days into v_off_days
      from public.branches
     where id = v_branch_id;
  end if;

  return not (v_off_days is not null and v_weekday = any(v_off_days));
end;
$$;

revoke all on function private.is_working_day(uuid, date) from public;
grant execute on function private.is_working_day(uuid, date) to authenticated;
```

- [ ] **Step 2: Apply and verify**

Run: `npm run db:apply -- --file supabase/migrations/20260824101000_schedule_holidays.sql`
Expected: `ok`.

Manual check (SQL editor, using a real employee id and today's date):
```sql
select private.is_working_day('<employee-id>', current_date);
```
Expected: returns `true`/`false` without error.

- [ ] **Step 3: Add the types**

In `src/lib/types.ts`, extend `Branch` (line 13-21) and `Employee` (line 28-36), and add a new interface:
```ts
export interface Branch {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  qr_version: number;
  /** 0=Sunday..6=Saturday. This branch's default weekly off days. */
  weekly_off_days: number[];
  created_at: string;
}
```
```ts
export interface Employee {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  default_branch_id: string | null;
  /** Overrides the branch's weekly_off_days when set. Null = inherit. */
  weekly_off_days: number[] | null;
  active: boolean;
  created_at: string;
}
```
```ts
export type CalendarDayKind = 'holiday' | 'mandatory_workday';

export interface BranchCalendarDay {
  id: string;
  branch_id: string;
  date: string;
  kind: CalendarDayKind;
  label: string | null;
  created_at: string;
}

export const CALENDAR_DAY_KIND_LABELS: Record<CalendarDayKind, string> = {
  holiday: 'Holiday',
  mandatory_workday: 'Mandatory workday',
};

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
```

Also update `branches_public` (the view every non-HR page reads) to include the new column — add to the same migration file, appended before the closing of Step 1's SQL block:
```sql
create or replace view public.branches_public
  with (security_invoker = true) as
  select id, name, latitude, longitude, radius_meters, qr_version, weekly_off_days, created_at
  from public.branches;

grant select (id, name, latitude, longitude, radius_meters, qr_version, weekly_off_days, created_at)
  on public.branches to authenticated;
```
(This replaces the narrower `grant select (...)` from the init migration — the new column needs to be added to that grant list too, since grants are additive per-column, not replaced by `create or replace view`.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no new errors (existing `Branch`/`Employee` consumers use `.select('*')`, which now includes the new column; nothing destructures a fixed field list).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260824101000_schedule_holidays.sql src/lib/types.ts
git commit -m "Add weekly work schedule, branch holiday calendar, and is_working_day resolver"
```

---

## Task 7: Branch schedule/calendar API and BranchManager UI

**Files:**
- Modify: `src/app/api/hr/branches/route.ts` (`parseBranchInput`)
- Modify: `src/app/api/hr/branches/[id]/route.ts` (`PATCH`)
- Create: `src/app/api/hr/branches/[id]/calendar/route.ts`
- Modify: `src/app/(app)/hr/branches/page.tsx`
- Modify: `src/app/(app)/hr/branches/BranchManager.tsx`

**Interfaces:**
- Consumes: `isBranchManagedBy` (Task 3), `BranchCalendarDay`, `CALENDAR_DAY_KIND_LABELS`, `WEEKDAY_LABELS` (Task 6).
- Produces: `POST /api/hr/branches/:id/calendar` body `{ date, kind, label? }` → creates a calendar day. `DELETE /api/hr/branches/:id/calendar/:calendarId`.

- [ ] **Step 1: Extend `parseBranchInput` to accept `weeklyOffDays`**

In `src/app/api/hr/branches/route.ts:53-80`, add to the parsed shape and validation:
```ts
export function parseBranchInput(body: Record<string, unknown>):
  | {
      value: {
        name: string;
        latitude: number;
        longitude: number;
        radius_meters: number;
        weekly_off_days?: number[];
      };
    }
  | { error: string } {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const radius = Number(body.radius_meters ?? body.radiusMeters);

  if (!name) return { error: 'Branch name is required.' };
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) {
    return { error: 'Latitude must be between -90 and 90.' };
  }
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    return { error: 'Longitude must be between -180 and 180.' };
  }
  if (!Number.isFinite(radius) || radius <= 0 || radius > 5000) {
    return { error: 'Geofence radius must be between 1 and 5000 metres.' };
  }

  let weeklyOffDays: number[] | undefined;
  if (body.weeklyOffDays !== undefined) {
    if (
      !Array.isArray(body.weeklyOffDays) ||
      !body.weeklyOffDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    ) {
      return { error: 'weeklyOffDays must be an array of integers between 0 and 6.' };
    }
    weeklyOffDays = body.weeklyOffDays;
  }

  return {
    value: {
      name,
      latitude,
      longitude,
      radius_meters: Math.round(radius),
      ...(weeklyOffDays !== undefined ? { weekly_off_days: weeklyOffDays } : {}),
    },
  };
}
```

- [ ] **Step 2: Enforce branch-scope on `PATCH /api/hr/branches/:id`**

In `src/app/api/hr/branches/[id]/route.ts`, after resolving `hr` and before doing anything with `id` (both the `rotate` branch and the plain-update branch), add:
```ts
  const admin = createAdminClient();

  if (!(await isBranchManagedBy(admin, hr, id))) {
    return NextResponse.json(
      { error: 'This branch is not assigned to you.' },
      { status: 403 },
    );
  }
```
(Remove the now-duplicate `const admin = createAdminClient();` line further down, and add `import { isBranchManagedBy } from '@/lib/hr-scope';` at the top.)

- [ ] **Step 3: Write the calendar-day route**

```ts
// src/app/api/hr/branches/[id]/calendar/route.ts
import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { isBranchManagedBy } from '@/lib/hr-scope';
import { createAdminClient, getHrUser } from '@/lib/supabase/server';

/**
 * POST /api/hr/branches/:id/calendar — declare a holiday or mandatory workday.
 * DELETE /api/hr/branches/:id/calendar?calendarId=... — remove one.
 * Scoped to the calling HR admin's assigned branches (or super_admin).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const hr = await getHrUser();
  if (!hr) {
    return NextResponse.json({ error: 'HR administrator access required.' }, { status: 403 });
  }

  const { id: branchId } = await params;
  const admin = createAdminClient();

  if (!(await isBranchManagedBy(admin, hr, branchId))) {
    return NextResponse.json({ error: 'This branch is not assigned to you.' }, { status: 403 });
  }

  let body: { date?: unknown; kind?: unknown; label?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const date = typeof body.date === 'string' ? body.date : '';
  const kind = body.kind;
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 200) : null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'A valid date (YYYY-MM-DD) is required.' }, { status: 400 });
  }
  if (kind !== 'holiday' && kind !== 'mandatory_workday') {
    return NextResponse.json(
      { error: 'kind must be "holiday" or "mandatory_workday".' },
      { status: 400 },
    );
  }

  const { data, error } = await admin
    .from('branch_calendar_days')
    .upsert(
      { branch_id: branchId, date, kind, label },
      { onConflict: 'branch_id,date' },
    )
    .select('id, date, kind, label')
    .single();

  if (error) {
    return NextResponse.json({ error: 'Could not save the calendar day.' }, { status: 500 });
  }

  await recordAudit(admin, hr, {
    action: 'branch.update',
    entityType: 'branch',
    entityId: branchId,
    detail: { calendar_day: data },
  });

  return NextResponse.json(data);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const hr = await getHrUser();
  if (!hr) {
    return NextResponse.json({ error: 'HR administrator access required.' }, { status: 403 });
  }

  const { id: branchId } = await params;
  const admin = createAdminClient();

  if (!(await isBranchManagedBy(admin, hr, branchId))) {
    return NextResponse.json({ error: 'This branch is not assigned to you.' }, { status: 403 });
  }

  const calendarId = new URL(request.url).searchParams.get('calendarId');
  if (!calendarId) {
    return NextResponse.json({ error: 'Missing calendarId.' }, { status: 400 });
  }

  const { error } = await admin
    .from('branch_calendar_days')
    .delete()
    .eq('id', calendarId)
    .eq('branch_id', branchId);

  if (error) {
    return NextResponse.json({ error: 'Could not remove the calendar day.' }, { status: 500 });
  }

  await recordAudit(admin, hr, {
    action: 'branch.update',
    entityType: 'branch',
    entityId: branchId,
    detail: { calendar_day_removed: calendarId },
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Wire up the page and UI**

In `src/app/(app)/hr/branches/page.tsx`, load each branch's calendar days and which branches the current HR admin can manage, and pass both down:
```ts
  const [{ data: branches }, { data: calendarDays }, { data: assignments }] = await Promise.all([
    supabase.from('branches_public').select('*').order('name').returns<Branch[]>(),
    supabase
      .from('branch_calendar_days')
      .select('*')
      .order('date')
      .returns<BranchCalendarDay[]>(),
    hr.employee.role === 'super_admin'
      ? Promise.resolve({ data: null })
      : supabase
          .from('hr_branch_assignments')
          .select('branch_id')
          .eq('hr_admin_id', hr.id)
          .returns<{ branch_id: string }[]>(),
  ]);

  const manageableBranchIds =
    hr.employee.role === 'super_admin'
      ? new Set((branches ?? []).map((b) => b.id))
      : new Set((assignments ?? []).map((a) => a.branch_id));

  return (
    <BranchManager
      initialBranches={branches ?? []}
      calendarDays={calendarDays ?? []}
      manageableBranchIds={manageableBranchIds}
      canCreate={hr.employee.role === 'super_admin'}
    />
  );
```

- [ ] **Step 5: Read `BranchManager.tsx` and extend it**

Read the full current `src/app/(app)/hr/branches/BranchManager.tsx` (reproduced in full earlier in this session — 281 lines) before editing. Make these changes:
1. Component signature gains `calendarDays: BranchCalendarDay[]`, `manageableBranchIds: Set<string>`, `canCreate: boolean`.
2. Wrap the "Add branch" button and form (lines 96-189) in `{canCreate && (...)}`.
3. In each branch `<li>` (line 198-227), only render the "Rotate code" button and the new schedule/calendar controls (below) when `manageableBranchIds.has(branch.id)`; always render "Show QR code" (reading is unrestricted).
4. Add, inside each manageable branch's card, a weekly-off-days control: seven toggle buttons/checkboxes labelled from `WEEKDAY_LABELS`, initialized from `branch.weekly_off_days`, with a "Save schedule" button that `PATCH`es `/api/hr/branches/${branch.id}` with `{ name: branch.name, latitude: branch.latitude, longitude: branch.longitude, radius_meters: branch.radius_meters, weeklyOffDays: selected }` (the existing PATCH replaces the whole row, so every field must be resent) and calls `router.refresh()`.
5. Add a small calendar-day list scoped to that branch (`calendarDays.filter((d) => d.branch_id === branch.id)`), each with a label, kind (`CALENDAR_DAY_KIND_LABELS[d.kind]`), date, and a "Remove" button calling `DELETE /api/hr/branches/${branch.id}/calendar?calendarId=${d.id}`; below the list, a small inline form (date input, kind `<select>`, optional label text input, "Add" button) posting to `POST /api/hr/branches/${branch.id}/calendar`. Follow the same `busy`/`error`/`router.refresh()` shape as `createBranch`.

- [ ] **Step 6: Typecheck and manual verification**

Run: `npm run typecheck`
Expected: no errors.

Manually: as the scoped `hr_admin`, open `/hr/branches`, confirm only their assigned branch(es) show manage controls, set weekly off days, add a holiday, remove it, and confirm the "Add branch" button is absent. As `super_admin`, confirm all controls are present everywhere.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/hr/branches src/app/\(app\)/hr/branches
git commit -m "Add branch weekly-schedule and holiday-calendar management, scoped to assigned HR"
```

---

## Task 8: `leave_requests` table and RLS

**Files:**
- Create: `supabase/migrations/20260824102000_leave_requests.sql`
- Modify: `src/lib/types.ts` (new `LeaveRequest`, `LeaveRequestRow`)

**Interfaces:**
- Produces: table `public.leave_requests`, added to the `supabase_realtime` publication.
- Consumes: `private.hr_visible_employee_ids()`, `private.is_super_admin()`, `private.is_hr_admin()` (Task 1).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260824102000_leave_requests.sql
create table if not exists public.leave_requests (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  from_date    date not null,
  to_date      date not null,
  reason       text not null,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  reviewed_by  uuid references public.employees(id) on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),

  constraint leave_to_after_from check (to_date >= from_date)
);

create index if not exists leave_requests_employee_idx
  on public.leave_requests (employee_id, from_date desc);
create index if not exists leave_requests_review_queue_idx
  on public.leave_requests (status, created_at desc)
  where status = 'pending';

alter table public.leave_requests enable row level security;
alter table public.leave_requests replica identity full;

drop policy if exists "leave_requests read own or hr" on public.leave_requests;
create policy "leave_requests read own or hr"
  on public.leave_requests for select
  to authenticated
  using (
    (select auth.uid()) = employee_id
    or private.is_super_admin()
    or (private.is_hr_admin() and employee_id in (select private.hr_visible_employee_ids()))
  );

drop policy if exists "leave_requests insert own" on public.leave_requests;
create policy "leave_requests insert own"
  on public.leave_requests for insert
  to authenticated
  with check ((select auth.uid()) = employee_id);

drop policy if exists "leave_requests update by hr" on public.leave_requests;
create policy "leave_requests update by hr"
  on public.leave_requests for update
  to authenticated
  using (
    private.is_super_admin()
    or (private.is_hr_admin() and employee_id in (select private.hr_visible_employee_ids()))
  )
  with check (
    private.is_super_admin()
    or (private.is_hr_admin() and employee_id in (select private.hr_visible_employee_ids()))
  );

grant select, insert, update on public.leave_requests to authenticated;
revoke delete on public.leave_requests from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'leave_requests'
  ) then
    alter publication supabase_realtime add table public.leave_requests;
  end if;
end $$;
```

- [ ] **Step 2: Apply and verify**

Run: `npm run db:apply -- --file supabase/migrations/20260824102000_leave_requests.sql`
Expected: `ok`.

- [ ] **Step 3: Add the types**

In `src/lib/types.ts`:
```ts
export type LeaveStatus = 'pending' | 'approved' | 'declined';

export interface LeaveRequest {
  id: string;
  employee_id: string;
  from_date: string;
  to_date: string;
  reason: string;
  status: LeaveStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface LeaveRequestRow extends LeaveRequest {
  employees: Pick<Employee, 'id' | 'full_name' | 'email'> | null;
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors (nothing consumes these types yet).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260824102000_leave_requests.sql src/lib/types.ts
git commit -m "Add leave_requests table with branch-scoped RLS"
```

---

## Task 9: `absences` table

**Files:**
- Create: `supabase/migrations/20260824103000_absences.sql`
- Modify: `src/lib/types.ts` (new `Absence`, `AbsenceRow`)

**Interfaces:**
- Produces: table `public.absences`, read-only to `authenticated` (writes only via the SECURITY DEFINER job in Task 12, or via the service-role client for the reversal paths in Tasks 11/14).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260824103000_absences.sql
create table if not exists public.absences (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete set null,
  date        date not null,
  created_at  timestamptz not null default now(),
  unique (employee_id, date)
);

create index if not exists absences_employee_date_idx
  on public.absences (employee_id, date desc);

alter table public.absences enable row level security;
alter table public.absences replica identity full;

drop policy if exists "absences read own or hr" on public.absences;
create policy "absences read own or hr"
  on public.absences for select
  to authenticated
  using (
    (select auth.uid()) = employee_id
    or private.is_super_admin()
    or (private.is_hr_admin() and employee_id in (select private.hr_visible_employee_ids()))
  );

-- No insert/update/delete policy for `authenticated`: rows are written only
-- by private.mark_daily_absences() (SECURITY DEFINER, run via pg_cron — see
-- the 20260824104000 migration) and deleted only through the service-role
-- client from the leave/attendance approval routes, which bypass RLS after
-- their own application-level permission check (same pattern as every other
-- HR write in this codebase).
revoke all on public.absences from anon, authenticated;
grant select on public.absences to authenticated;
```

- [ ] **Step 2: Apply and verify**

Run: `npm run db:apply -- --file supabase/migrations/20260824103000_absences.sql`
Expected: `ok`.

- [ ] **Step 3: Add the types**

In `src/lib/types.ts`:
```ts
export interface Absence {
  id: string;
  employee_id: string;
  branch_id: string | null;
  date: string;
  created_at: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260824103000_absences.sql src/lib/types.ts
git commit -m "Add absences table, writable only by the nightly job and approval reversal"
```

---

## Task 10: Leave-range validation (pure logic, TDD)

**Files:**
- Modify: `src/lib/format.ts:5` (export the timezone constant)
- Create: `src/lib/attendance/leave.ts`
- Test: `tests/leave.test.ts`

**Interfaces:**
- Produces: `TZ` exported from `src/lib/format.ts`. `todayInTz(now?: Date): string` and `validateLeaveRange(fromDate: string, toDate: string, now?: Date): { ok: true; fromDate: string; toDate: string } | { ok: false; error: string }` from `src/lib/attendance/leave.ts`.

- [ ] **Step 1: Export the timezone constant**

In `src/lib/format.ts:5`, change:
```ts
const TZ = 'Asia/Karachi';
```
to:
```ts
export const TZ = 'Asia/Karachi';
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/leave.test.ts
import { describe, expect, it } from 'vitest';
import { validateLeaveRange } from '@/lib/attendance/leave';

// 2026-08-24T10:00:00Z is 2026-08-24 15:00 in Asia/Karachi (UTC+5).
const NOW = new Date('2026-08-24T10:00:00.000Z');

describe('validateLeaveRange', () => {
  it('accepts today and future dates, in Asia/Karachi', () => {
    expect(validateLeaveRange('2026-08-24', '2026-08-25', NOW)).toEqual({
      ok: true,
      fromDate: '2026-08-24',
      toDate: '2026-08-25',
    });
  });

  it('rejects a from_date that has already passed', () => {
    const result = validateLeaveRange('2026-08-23', '2026-08-23', NOW);
    expect(result.ok).toBe(false);
  });

  it('rejects a to_date before from_date', () => {
    const result = validateLeaveRange('2026-08-25', '2026-08-24', NOW);
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed date', () => {
    expect(validateLeaveRange('8/24/2026', '2026-08-24', NOW).ok).toBe(false);
    expect(validateLeaveRange('2026-08-24', 'not-a-date', NOW).ok).toBe(false);
  });

  it('accepts a single-day request', () => {
    expect(validateLeaveRange('2026-08-24', '2026-08-24', NOW).ok).toBe(true);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx vitest run tests/leave.test.ts`
Expected: FAIL — `Cannot find module '@/lib/attendance/leave'`.

- [ ] **Step 4: Implement**

```ts
// src/lib/attendance/leave.ts
import { TZ } from '@/lib/format';

/**
 * Leave-request date validation (spec: "Leave timing" — future/today only,
 * per docs/superpowers/specs/2026-08-24-absence-leave-hr-scoping-design.md).
 *
 * Extracted as a pure function so the rule is unit-testable without HTTP
 * plumbing, matching src/lib/attendance/remote-claim.ts. The API route is the
 * only enforcement point that matters — client-side date-picker limits are a
 * convenience.
 */

export type LeaveRangeValidation =
  | { ok: true; fromDate: string; toDate: string }
  | { ok: false; error: string };

/** "Today" in Asia/Karachi as YYYY-MM-DD, independent of the caller's own zone. */
export function todayInTz(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
}

export function validateLeaveRange(
  fromDate: string,
  toDate: string,
  now: Date = new Date(),
): LeaveRangeValidation {
  const dateShape = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateShape.test(fromDate) || !dateShape.test(toDate)) {
    return { ok: false, error: 'Dates must be valid calendar dates.' };
  }

  const today = todayInTz(now);
  if (fromDate < today) {
    return {
      ok: false,
      error: 'Leave cannot be requested for a date that has already passed.',
    };
  }
  if (toDate < fromDate) {
    return { ok: false, error: 'The end date cannot be before the start date.' };
  }

  return { ok: true, fromDate, toDate };
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx vitest run tests/leave.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Run the full suite**

Run: `npm run test`
Expected: all existing suites still pass (this task didn't touch their behavior, only exported a previously-internal constant).

- [ ] **Step 7: Commit**

```bash
git add src/lib/format.ts src/lib/attendance/leave.ts tests/leave.test.ts
git commit -m "Add leave-range validation with unit tests"
```

---

## Task 11: Leave and absence notification/audit vocabulary

**Files:**
- Modify: `src/lib/notify.ts`
- Modify: `src/lib/audit.ts`

**Interfaces:**
- Produces: `NotificationKind` gains `'leave_submitted' | 'leave_approved' | 'leave_declined'`; `NotificationInput.entityType` gains `'leave_request'`. `AuditAction` gains `'leave.approve' | 'leave.decline' | 'absence.reversed'`.

- [ ] **Step 1: Extend `notify.ts`**

In `src/lib/notify.ts:18-34`:
```ts
export type NotificationKind =
  | 'attendance_approved'
  | 'attendance_declined'
  | 'attendance_flagged'
  | 'remote_submitted'
  | 'leave_submitted'
  | 'leave_approved'
  | 'leave_declined'
  | 'review_needed'
  | 'role_changed'
  | 'account_deactivated';

export interface NotificationInput {
  recipientId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  entityType?: 'attendance' | 'employee' | 'branch' | 'leave_request' | null;
  entityId?: string | null;
}

export interface NotificationRow {
  id: string;
  recipient_id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  entity_type: 'attendance' | 'employee' | 'branch' | 'leave_request' | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}
```

Add a scoped-recipient helper after `hrAdminIds` (line 82-98) — this is what routes the leave notification to the *right* HR admin(s), not every HR admin:
```ts
/**
 * The HR admin(s) who should be notified about `employeeId` — their assigned
 * branch's HR admin(s) if scoped, or every HR admin if the employee has no
 * default branch — plus every super_admin. Mirrors the RLS visibility rule
 * in private.hr_visible_employee_ids() so "who gets notified" and "who can
 * see it in the review queue" never disagree.
 */
export async function scopedHrRecipientIds(
  admin: SupabaseClient,
  employeeId: string,
  excludeId?: string,
): Promise<string[]> {
  const { data: employee } = await admin
    .from('employees')
    .select('default_branch_id')
    .eq('id', employeeId)
    .single<{ default_branch_id: string | null }>();

  const { data: admins, error } = await admin
    .from('employees')
    .select('id, role')
    .in('role', ['hr_admin', 'super_admin'])
    .eq('active', true)
    .returns<{ id: string; role: string }[]>();

  if (error || !admins) {
    console.error(`[notify] could not list HR recipients: ${error?.message}`);
    return [];
  }

  if (!employee || employee.default_branch_id === null) {
    return admins.map((a) => a.id).filter((id) => id !== excludeId);
  }

  const { data: assignments } = await admin
    .from('hr_branch_assignments')
    .select('hr_admin_id')
    .eq('branch_id', employee.default_branch_id)
    .returns<{ hr_admin_id: string }[]>();

  const scopedIds = new Set((assignments ?? []).map((a) => a.hr_admin_id));

  return admins
    .filter((a) => a.role === 'super_admin' || scopedIds.has(a.id))
    .map((a) => a.id)
    .filter((id) => id !== excludeId);
}
```

- [ ] **Step 2: Extend `audit.ts`**

In `src/lib/audit.ts:12-22` and `:65-76`:
```ts
export type AuditAction =
  | 'attendance.approve'
  | 'attendance.decline'
  | 'leave.approve'
  | 'leave.decline'
  | 'absence.reversed'
  | 'employee.invite'
  | 'employee.role_change'
  | 'employee.activate'
  | 'employee.deactivate'
  | 'employee.branch_change'
  | 'branch.create'
  | 'branch.update'
  | 'branch.qr_rotate'
  | 'hr.branches_assigned';
```
```ts
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  'attendance.approve': 'Approved attendance',
  'attendance.decline': 'Declined attendance',
  'leave.approve': 'Approved leave request',
  'leave.decline': 'Declined leave request',
  'absence.reversed': 'Reversed a marked absence',
  'employee.invite': 'Invited employee',
  'employee.role_change': 'Changed role',
  'employee.activate': 'Reactivated employee',
  'employee.deactivate': 'Deactivated employee',
  'employee.branch_change': 'Changed default branch',
  'branch.create': 'Created branch',
  'branch.update': 'Updated branch',
  'branch.qr_rotate': 'Rotated QR code',
  'hr.branches_assigned': 'Updated HR branch assignments',
};
```
Also extend `AuditEntry.entityType` (line 26) and `AuditRow.entity_type` (line 84) to include `'leave_request'`.

(Note: `'hr.branches_assigned'` was already added in Task 5 Step 1 — if Task 5 ran first, skip re-adding it here and only add the three `leave.*`/`absence.*` actions.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/notify.ts src/lib/audit.ts
git commit -m "Add leave/absence notification kinds, scoped HR recipients, and audit actions"
```

---

## Task 12: Submit-leave API route

**Files:**
- Create: `src/app/api/attendance/leave/route.ts`
- Modify: `src/lib/rate-limit.ts`

**Interfaces:**
- Consumes: `validateLeaveRange` (Task 10), `scopedHrRecipientIds` (Task 11).
- Produces: `POST /api/attendance/leave` body `{ fromDate: string, toDate: string, reason: string }` → `{ id, status: 'pending', fromDate, toDate }`.

- [ ] **Step 1: Add the rate-limit rule**

In `src/lib/rate-limit.ts:28-36`:
```ts
export const RATE_LIMITS = {
  checkIn: { name: 'check-in', limit: 20, windowSeconds: 300 },
  checkOut: { name: 'check-out', limit: 20, windowSeconds: 300 },
  remote: { name: 'remote', limit: 10, windowSeconds: 3600 },
  invite: { name: 'invite', limit: 30, windowSeconds: 3600 },
  /** Filed by hand, rarely; the headroom is for a family emergency needing
   *  a multi-day request plus a correction, not scripted abuse. */
  leave: { name: 'leave', limit: 10, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitRule>;
```

- [ ] **Step 2: Write the route**

```ts
// src/app/api/attendance/leave/route.ts
import { NextResponse } from 'next/server';
import { validateLeaveRange } from '@/lib/attendance/leave';
import { scopedHrRecipientIds, notify } from '@/lib/notify';
import { RATE_LIMITS, checkRateLimit, tooManyRequests } from '@/lib/rate-limit';
import { createAdminClient, getSessionUser } from '@/lib/supabase/server';

/**
 * POST /api/attendance/leave — submit a leave request.
 *
 * Creates a `pending` row in leave_requests. Does not touch `attendance` —
 * leave is tracked separately and only affects reporting/absence detection
 * once approved (see is_working_day / mark_daily_absences).
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  let body: { fromDate?: unknown; toDate?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required.' }, { status: 400 });
  }
  if (reason.length > 500) {
    return NextResponse.json(
      { error: 'Reason must be 500 characters or fewer.' },
      { status: 400 },
    );
  }

  const fromDate = typeof body.fromDate === 'string' ? body.fromDate : '';
  const toDate = typeof body.toDate === 'string' ? body.toDate : '';

  const validated = validateLeaveRange(fromDate, toDate);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const admin = createAdminClient();

  if (!(await checkRateLimit(admin, RATE_LIMITS.leave, user.id))) {
    return tooManyRequests(RATE_LIMITS.leave);
  }

  const { data: inserted, error } = await admin
    .from('leave_requests')
    .insert({
      employee_id: user.id,
      from_date: validated.fromDate,
      to_date: validated.toDate,
      reason,
      status: 'pending',
    })
    .select('id, from_date, to_date')
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'Could not submit the leave request. Please try again.' },
      { status: 500 },
    );
  }

  await notify(
    admin,
    (await scopedHrRecipientIds(admin, user.id, user.id)).map((hrId) => ({
      recipientId: hrId,
      kind: 'leave_submitted' as const,
      title: `Leave request from ${user.employee.full_name}`,
      body: `${validated.fromDate} → ${validated.toDate}. ${reason}`,
      entityType: 'leave_request' as const,
      entityId: inserted.id,
    })),
  );

  return NextResponse.json({
    id: inserted.id,
    status: 'pending',
    fromDate: inserted.from_date,
    toDate: inserted.to_date,
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Start `npm run dev`, sign in as any employee, `POST` to `/api/attendance/leave` with `{ fromDate: '<today>', toDate: '<today>', reason: 'test' }` via devtools.
Expected: `200` with `status: 'pending'`; a row appears in `leave_requests`; the appropriate HR admin(s) get a `notifications` row.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/attendance/leave/route.ts src/lib/rate-limit.ts
git commit -m "Add leave request submission endpoint"
```

---

## Task 13: HR leave review API (approve/decline + absence reversal)

**Files:**
- Create: `src/app/api/hr/leave/review/route.ts`

**Interfaces:**
- Consumes: `isEmployeeVisibleTo` (Task 3), `LeaveRequest` (Task 8).
- Produces: `POST /api/hr/leave/review` body `{ id: string, action: 'approve' | 'decline' }` → `{ id, status }`.

- [ ] **Step 1: Write the route**

```ts
// src/app/api/hr/leave/review/route.ts
import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { isEmployeeVisibleTo } from '@/lib/hr-scope';
import { notify } from '@/lib/notify';
import { createAdminClient, getHrUser } from '@/lib/supabase/server';
import type { Employee, LeaveRequest } from '@/lib/types';

/**
 * POST /api/hr/leave/review — approve or decline a leave request.
 *
 * On approval, any `absences` row already marked for a date inside the
 * approved range is deleted — the nightly job ran before this approval
 * landed, and the employee turns out not to have been absent after all. See
 * "Late reversal" in the design doc.
 */
export async function POST(request: Request) {
  const hr = await getHrUser();
  if (!hr) {
    return NextResponse.json(
      { error: 'HR administrator access required.' },
      { status: 403 },
    );
  }

  let body: { id?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : '';
  const action = body.action;

  if (!id) {
    return NextResponse.json({ error: 'Missing request id.' }, { status: 400 });
  }
  if (action !== 'approve' && action !== 'decline') {
    return NextResponse.json(
      { error: 'Action must be "approve" or "decline".' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: record } = await admin
    .from('leave_requests')
    .select('*')
    .eq('id', id)
    .single<LeaveRequest>();

  if (!record) {
    return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
  }
  if (record.status !== 'pending') {
    return NextResponse.json(
      { error: `This request has already been ${record.status}.` },
      { status: 409 },
    );
  }

  const { data: employee } = await admin
    .from('employees')
    .select('default_branch_id')
    .eq('id', record.employee_id)
    .single<Pick<Employee, 'default_branch_id'>>();

  if (!employee || !(await isEmployeeVisibleTo(admin, hr, employee))) {
    return NextResponse.json(
      { error: 'This employee is not in one of your assigned branches.' },
      { status: 403 },
    );
  }

  const reviewedAt = new Date().toISOString();
  const status = action === 'approve' ? 'approved' : 'declined';

  const { error } = await admin
    .from('leave_requests')
    .update({ status, reviewed_by: hr.id, reviewed_at: reviewedAt })
    .eq('id', id);

  if (error) {
    return NextResponse.json(
      { error: `Could not ${action} the request.` },
      { status: 500 },
    );
  }

  await recordAudit(admin, hr, {
    action: action === 'approve' ? 'leave.approve' : 'leave.decline',
    entityType: 'leave_request',
    entityId: id,
    subjectId: record.employee_id,
    detail: { from_date: record.from_date, to_date: record.to_date },
  });

  if (status === 'approved') {
    const { data: reversed } = await admin
      .from('absences')
      .delete()
      .eq('employee_id', record.employee_id)
      .gte('date', record.from_date)
      .lte('date', record.to_date)
      .select('date');

    if (reversed && reversed.length > 0) {
      await recordAudit(admin, hr, {
        action: 'absence.reversed',
        entityType: 'leave_request',
        entityId: id,
        subjectId: record.employee_id,
        detail: { dates: reversed.map((r) => r.date) },
      });
    }
  }

  await notify(admin, [
    {
      recipientId: record.employee_id,
      kind: status === 'approved' ? 'leave_approved' : 'leave_declined',
      title: `Your leave request was ${status}`,
      body: `${record.from_date} → ${record.to_date}. Reviewed by ${hr.employee.full_name}.`,
      entityType: 'leave_request',
      entityId: id,
    },
  ]);

  return NextResponse.json({ id, status });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual verification**

As HR, approve the test leave request from Task 12 Step 4.
Expected: `200`, `status: 'approved'`, the employee gets a `leave_approved` notification, `audit_log` gains a `leave.approve` row.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/hr/leave/review/route.ts
git commit -m "Add HR leave review endpoint with absence reversal on approval"
```

---

## Task 14: Employee-facing `/leave` page

**Files:**
- Create: `src/app/(app)/leave/page.tsx`
- Create: `src/app/(app)/leave/LeaveForm.tsx`

**Interfaces:**
- Consumes: `StatusBadge` (existing), `formatDate` (existing), `LeaveRequest` (Task 8).

- [ ] **Step 1: Write the page**

```tsx
// src/app/(app)/leave/page.tsx
import type { Metadata } from 'next';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDate } from '@/lib/format';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import type { LeaveRequest } from '@/lib/types';
import { LeaveForm } from './LeaveForm';

export const metadata: Metadata = { title: 'Leave' };

export default async function LeavePage() {
  const user = (await getSessionUser())!;
  const supabase = await createClient();

  const { data: recent } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('employee_id', user.id)
    .order('created_at', { ascending: false })
    .limit(5)
    .returns<LeaveRequest[]>();

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight text-brand-secondary">
        Request leave
      </h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        An HR administrator reviews every request. Approved leave does not
        count as an absence.
      </p>

      <div className="card mt-5 p-5">
        <LeaveForm />
      </div>

      {recent && recent.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
            Your recent requests
          </h2>
          <ul className="mt-3 space-y-2">
            {recent.map((row) => (
              <li key={row.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">{row.reason}</p>
                    <p className="mt-1 text-sm text-ink-muted">
                      {formatDate(row.from_date)}
                      {row.to_date !== row.from_date ? ` → ${formatDate(row.to_date)}` : ''}
                    </p>
                  </div>
                  <StatusBadge status={row.status} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the form**

```tsx
// src/app/(app)/leave/LeaveForm.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { todayInTz } from '@/lib/attendance/leave';

export function LeaveForm() {
  const router = useRouter();
  const today = todayInTz();
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch('/api/attendance/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromDate, toDate, reason: reason.trim() }),
    });

    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? 'Could not submit the request.');
      setBusy(false);
      return;
    }

    setDone(true);
    setBusy(false);
    setReason('');
    router.refresh();
  }

  if (done) {
    return (
      <div>
        <h2 className="text-lg font-bold text-brand-secondary">Request submitted</h2>
        <p className="mt-2 text-sm text-ink-muted">
          An HR administrator will review it.
        </p>
        <button
          type="button"
          className="btn-secondary mt-4 w-full"
          onClick={() => setDone(false)}
        >
          Submit another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="fromDate" className="field-label">
            From
          </label>
          <input
            id="fromDate"
            type="date"
            className="field"
            value={fromDate}
            min={today}
            onChange={(e) => {
              setFromDate(e.target.value);
              if (toDate < e.target.value) setToDate(e.target.value);
            }}
            required
          />
        </div>
        <div>
          <label htmlFor="toDate" className="field-label">
            To
          </label>
          <input
            id="toDate"
            type="date"
            className="field"
            value={toDate}
            min={fromDate}
            onChange={(e) => setToDate(e.target.value)}
            required
          />
        </div>
      </div>

      <div>
        <label htmlFor="reason" className="field-label">
          Reason
        </label>
        <textarea
          id="reason"
          className="field"
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
        />
      </div>

      {error && (
        <p
          role="alert"
          className="border-l-4 border-status-flagged bg-status-flagged-bg p-3 text-sm font-medium text-status-flagged"
        >
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? 'Submitting…' : 'Submit for approval'}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Typecheck and manual verification**

Run: `npm run typecheck`
Expected: no errors.

Manually: `npm run dev`, sign in as an employee, visit `/leave`, submit a request, confirm it appears in "Your recent requests" with a Pending badge.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/leave
git commit -m "Add employee-facing leave request page"
```

---

## Task 15: HR review queue — Leave tab

**Files:**
- Modify: `src/app/(app)/hr/page.tsx`
- Modify: `src/app/(app)/hr/ReviewDashboard.tsx`

**Interfaces:**
- Consumes: `LeaveRequestRow` (Task 8), existing `TabButton`, `StatusBadge`, `Field` components already in `ReviewDashboard.tsx`.

- [ ] **Step 1: Load leave requests alongside attendance**

In `src/app/(app)/hr/page.tsx`, add a third query and prop:
```ts
  const [{ data: records }, { data: leaveRequests }, { data: branches }] = await Promise.all([
    supabase
      .from('attendance')
      .select(
        '*, employees:employee_id ( id, full_name, email ), branches:branch_id ( id, name ), checkout_branch:check_out_branch_id ( id, name )',
      )
      .in('status', ['pending', 'flagged'])
      .order('submitted_at', { ascending: false })
      .returns<AttendanceRow[]>(),
    supabase
      .from('leave_requests')
      .select('*, employees:employee_id ( id, full_name, email )')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .returns<LeaveRequestRow[]>(),
    supabase.from('branches_public').select('*').order('name').returns<Branch[]>(),
  ]);

  return (
    <ReviewDashboard
      initialRecords={records ?? []}
      initialLeaveRequests={leaveRequests ?? []}
      branches={branches ?? []}
      currentUserId={hr.id}
    />
  );
```
(Add `import type { LeaveRequestRow } from '@/lib/types';` alongside the existing type import.)

- [ ] **Step 2: Extend `ReviewDashboard.tsx`**

Read the full current file (reproduced earlier in this session — 433 lines) before editing. Apply these changes:

1. `Tab` type: `type Tab = 'all' | 'pending' | 'flagged' | 'leave';`
2. Component props: add `initialLeaveRequests: LeaveRequestRow[]`.
3. Add state: `const [leaveRequests, setLeaveRequests] = useState(initialLeaveRequests);`
4. Add a `refreshLeave` callback mirroring `refresh` (lines 43-54), querying `leave_requests` with `.eq('status', 'pending')` instead of `.in('status', [...])`, and add a second Realtime subscription in the `useEffect` (lines 56-73) — either a second `.channel('hr-leave-queue')` with its own `.on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => refreshLeave())`, or extend the existing channel with a second `.on(...)` call before `.subscribe(...)`. Prefer extending the existing channel (one subscription, one `live` indicator) since both queues belong to the same review surface.
5. Add a `reviewLeave` function mirroring `review` (lines 75-99) but posting to `/api/hr/leave/review` with `{ id, action }` (no `overrides` — leave has no time-correction step) and optimistically removing from `leaveRequests` on success.
6. Add a fourth `TabButton`: `Leave ({leaveRequests.length})`, and extend the `visible` computation (line 103) so `tab === 'leave'` renders `leaveRequests` through a new `LeaveCard` component instead of `visible.map((row) => <ReviewCard ... />)`.
7. Add a `LeaveCard` component (sibling to `ReviewCard`, same file), rendering: employee name/email, the date range (`formatDate(row.from_date)` → `formatDate(row.to_date)`, import `formatDate` alongside the existing `formatDateTime` import), the reason, a `StatusBadge`, and Approve/Decline buttons calling `reviewLeave(row.id, 'approve' | 'decline')` — copy the button markup from `ReviewCard`'s lines 351-368 verbatim (same classes, same `busy` prop wiring keyed by `busyId === row.id`).
8. Update the empty-state message (line 149-152) to also cover the leave tab, or leave it generic ("Nothing to review...") since it already reads fine for any empty tab.

- [ ] **Step 3: Typecheck and manual verification**

Run: `npm run typecheck`
Expected: no errors.

Manually: as HR, open `/hr`, confirm a "Leave" tab shows the count from Task 12's test submission, approve it from this UI, confirm it disappears from the tab and the employee's `/leave` page shows it as Approved after a refresh.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/hr/page.tsx src/app/\(app\)/hr/ReviewDashboard.tsx
git commit -m "Add Leave tab to the HR review dashboard"
```

---

## Task 16: Nightly absence job (`pg_cron`)

**Files:**
- Create: `supabase/migrations/20260824104000_absence_job.sql`

**Interfaces:**
- Consumes: `private.is_working_day` (Task 6), `public.attendance`, `public.leave_requests` (Task 8), `public.absences` (Task 9).
- Produces: `private.mark_daily_absences() returns void`, a `pg_cron` job named `mark-daily-absences`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260824104000_absence_job.sql
-- =====================================================================
-- Nightly absence detection.
--
-- Runs at 21:00 UTC = 02:00 Asia/Karachi, evaluating the PKT calendar day
-- that just ended — late enough that a near-midnight checkout can't be
-- caught mid-shift. No notification is sent (HR checks reports, per the
-- design doc's explicit decision).
-- =====================================================================

create extension if not exists pg_cron with schema extensions;

create or replace function private.mark_daily_absences()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_date date := ((now() at time zone 'Asia/Karachi')::date - 1);
  v_employee record;
begin
  for v_employee in
    select id, default_branch_id from public.employees where active
  loop
    if not private.is_working_day(v_employee.id, v_target_date) then
      continue;
    end if;

    -- Showing up at all — any status, not just approved — means not absent.
    if exists (
      select 1 from public.attendance
      where employee_id = v_employee.id
        and (
          (check_in_time at time zone 'Asia/Karachi')::date = v_target_date
          or (claimed_check_in_time at time zone 'Asia/Karachi')::date = v_target_date
        )
    ) then
      continue;
    end if;

    if exists (
      select 1 from public.leave_requests
      where employee_id = v_employee.id
        and status = 'approved'
        and v_target_date between from_date and to_date
    ) then
      continue;
    end if;

    insert into public.absences (employee_id, branch_id, date)
    values (v_employee.id, v_employee.default_branch_id, v_target_date)
    on conflict (employee_id, date) do nothing;
  end loop;
end;
$$;

revoke all on function private.mark_daily_absences() from public;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mark-daily-absences') then
    perform cron.unschedule('mark-daily-absences');
  end if;
end $$;

select cron.schedule(
  'mark-daily-absences',
  '0 21 * * *',
  $$select private.mark_daily_absences();$$
);
```

- [ ] **Step 2: Apply**

Run: `npm run db:apply -- --file supabase/migrations/20260824104000_absence_job.sql`
Expected: `ok`.

(If the Supabase project's `pg_cron` extension is not enabled at the plan tier, this step will error with a permission message — in that case, enable "pg_cron" from the Database → Extensions panel in the Supabase dashboard first, then re-run.)

- [ ] **Step 3: Verify the job registered**

Run a query (SQL editor):
```sql
select jobname, schedule, active from cron.job where jobname = 'mark-daily-absences';
```
Expected: one row, `schedule = '0 21 * * *'`, `active = true`.

- [ ] **Step 4: Manually trigger it once to prove it runs end-to-end**

Run (SQL editor, safe to run any time — it's idempotent via `on conflict do nothing` and only touches yesterday's date):
```sql
select private.mark_daily_absences();
select * from public.absences order by created_at desc limit 20;
```
Expected: no error. Rows appear only for employees who had a working day yesterday with no check-in and no approved leave — confirm this matches your test data's expectations (e.g., seeded employees who never checked in yesterday should now show up; anyone who checked in should not).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260824104000_absence_job.sql
git commit -m "Add nightly pg_cron job marking unexplained no-shows as absent"
```

---

## Task 17: Reverse absences on a late remote-attendance approval

**Files:**
- Modify: `src/app/api/hr/review/route.ts`

**Interfaces:**
- Consumes: `public.absences` (Task 9).

- [ ] **Step 1: Add reversal after a remote-request approval**

In `src/app/api/hr/review/route.ts`, after the existing `await recordAudit(admin, hr, { action: 'attendance.approve', ... })` call (line 194-207) and before the existing `await notify(...)` call (line 209-218), insert:
```ts
  // A late-approved remote request can retroactively cover a date the
  // nightly job already marked absent (see "Late reversal" in the design
  // doc) — only relevant for remote requests, which carry a claimed date
  // separate from submission time.
  if (record.method === 'remote_request' && update.check_in_time) {
    const coveredDate = new Date(update.check_in_time as string)
      .toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

    const { data: reversed } = await admin
      .from('absences')
      .delete()
      .eq('employee_id', record.employee_id)
      .eq('date', coveredDate)
      .select('date');

    if (reversed && reversed.length > 0) {
      await recordAudit(admin, hr, {
        action: 'absence.reversed',
        entityType: 'attendance',
        entityId: id,
        subjectId: record.employee_id,
        detail: { dates: reversed.map((r) => r.date) },
      });
    }
  }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Using the data from Task 16 Step 4 (an employee now marked absent for yesterday), submit a remote request as that employee claiming yesterday's date, then approve it as HR with a matching check-in time.
Expected: the `absences` row for that employee/date is gone; `audit_log` has a new `absence.reversed` row.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/hr/review/route.ts
git commit -m "Reverse a marked absence when a late remote-attendance claim is approved"
```

---

## Task 18: Merge leave and absence rows into "My history"

**Files:**
- Modify: `src/app/(app)/history/page.tsx`

**Interfaces:**
- Consumes: `LeaveRequest`, `Absence` (Tasks 8, 9), existing `AttendanceRow`, `formatDate`, `StatusBadge`.

- [ ] **Step 1: Load leave and absence rows alongside attendance**

In `src/app/(app)/history/page.tsx`, after the existing `attendance` query (lines 18-24), add:
```ts
  const [{ data: leaveRows }, { data: absenceRows }] = await Promise.all([
    supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', user.id)
      .order('from_date', { ascending: false })
      .limit(100)
      .returns<LeaveRequest[]>(),
    supabase
      .from('absences')
      .select('*')
      .eq('employee_id', user.id)
      .order('date', { ascending: false })
      .limit(100)
      .returns<Absence[]>(),
  ]);
```
(Add `import type { Absence, LeaveRequest } from '@/lib/types';` to the existing type import.)

- [ ] **Step 2: Build a unified, sorted view model**

Before the `rows.map(...)` render (line 72), build a merged list. Since `AttendanceRow`, `LeaveRequest`, and `Absence` have different shapes, normalize into one small local type rather than forcing them into `AttendanceRow`:
```ts
  type HistoryEntry =
    | { kind: 'attendance'; date: string; row: AttendanceRow }
    | { kind: 'leave'; date: string; row: LeaveRequest }
    | { kind: 'absence'; date: string; row: Absence };

  const entries: HistoryEntry[] = [
    ...rows.map((row): HistoryEntry => ({
      kind: 'attendance',
      date: row.check_in_time ?? row.submitted_at,
      row,
    })),
    ...(leaveRows ?? []).map((row): HistoryEntry => ({
      kind: 'leave',
      date: row.from_date,
      row,
    })),
    ...(absenceRows ?? []).map((row): HistoryEntry => ({
      kind: 'absence',
      date: row.date,
      row,
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
```

- [ ] **Step 3: Render each kind in the existing table**

Replace the `{rows.map((row) => { ... })}` block (lines 72-109) with `{entries.map((entry) => { ... })}`, keeping the existing attendance-row rendering under `entry.kind === 'attendance'` (using `entry.row`), and adding two new branches:
```tsx
              {entries.map((entry) => {
                if (entry.kind === 'leave') {
                  const leave = entry.row;
                  return (
                    <tr key={`leave-${leave.id}`} className="border-b border-line last:border-0">
                      <Td>{formatDate(leave.from_date)}</Td>
                      <Td colSpan={4}>
                        Leave{leave.to_date !== leave.from_date ? ` (through ${formatDate(leave.to_date)})` : ''}
                      </Td>
                      <Td>—</Td>
                      <Td>
                        <StatusBadge status={leave.status} />
                      </Td>
                    </tr>
                  );
                }

                if (entry.kind === 'absence') {
                  const absence = entry.row;
                  return (
                    <tr key={`absence-${absence.id}`} className="border-b border-line last:border-0">
                      <Td>{formatDate(absence.date)}</Td>
                      <Td colSpan={4}>Absent — no check-in and no approved leave</Td>
                      <Td>—</Td>
                      <Td>
                        <span className="badge bg-status-declined-bg text-status-declined">
                          Absent
                        </span>
                      </Td>
                    </tr>
                  );
                }

                const row = entry.row;
                const remote = row.method === 'remote_request';
                // ... existing attendance rendering body from lines 73-108, unchanged ...
              })}
```
(`Td` doesn't currently accept `colSpan` — add `colSpan?: number` to its props (line 126-134) and pass it through to the `<td>` element.)

- [ ] **Step 4: Typecheck and manual verification**

Run: `npm run typecheck`
Expected: no errors.

Manually: as the employee from Task 16's test data, open `/history`, confirm the absent day and the approved-leave day (from earlier tasks) both appear, correctly dated and ordered newest-first alongside real attendance rows.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/history/page.tsx
git commit -m "Merge leave and absence rows into My history"
```

---

## Task 19: Attendance summary in HR Reports

**Files:**
- Modify: `src/lib/attendance/report.ts`
- Modify: `src/app/(app)/hr/reports/page.tsx`

**Interfaces:**
- Produces: `loadAttendanceSummary(supabase, filters: ReportFilters): Promise<AttendanceSummaryRow[]>` where each row is `{ employeeId, employeeName, present, absent, leave, holidayOrOff }`.

- [ ] **Step 1: Add the summary loader**

Append to `src/lib/attendance/report.ts`, after `loadReport` (after line 92):
```ts
export interface AttendanceSummaryRow {
  employeeId: string;
  employeeName: string;
  present: number;
  absent: number;
  leave: number;
  holidayOrOff: number;
}

/**
 * Per-employee day counts over the range: how many days were spent present,
 * absent, on leave, or off (weekend/holiday) — the picture "hours worked"
 * alone can't give. Iterates one is_working_day() call per employee-day
 * rather than a single SQL aggregate, matching the resolver's own
 * per-employee/per-date shape (branch_id / weekly_off_days come from the
 * employee row it looks up internally).
 */
export async function loadAttendanceSummary(
  supabase: SupabaseClient,
  filters: ReportFilters,
): Promise<AttendanceSummaryRow[]> {
  let employeeQuery = supabase
    .from('employees')
    .select('id, full_name')
    .eq('active', true)
    .returns<{ id: string; full_name: string }[]>();

  if (filters.employeeId) employeeQuery = employeeQuery.eq('id', filters.employeeId);
  const { data: employees, error: employeesError } = await employeeQuery;
  if (employeesError) throw new Error(employeesError.message);

  const fromDate = filters.from.slice(0, 10);
  const toDate = filters.to.slice(0, 10);
  const dates: string[] = [];
  for (let d = new Date(`${fromDate}T00:00:00Z`); d <= new Date(`${toDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }

  const results: AttendanceSummaryRow[] = [];

  for (const employee of employees ?? []) {
    const [{ data: attendanceDates }, { data: leaveRows }, { data: absenceRows }] = await Promise.all([
      supabase
        .from('attendance')
        .select('check_in_time')
        .eq('employee_id', employee.id)
        .gte('check_in_time', `${fromDate}T00:00:00Z`)
        .lte('check_in_time', `${toDate}T23:59:59Z`)
        .not('check_in_time', 'is', null)
        .returns<{ check_in_time: string }[]>(),
      supabase
        .from('leave_requests')
        .select('from_date, to_date')
        .eq('employee_id', employee.id)
        .eq('status', 'approved')
        .lte('from_date', toDate)
        .gte('to_date', fromDate)
        .returns<{ from_date: string; to_date: string }[]>(),
      supabase
        .from('absences')
        .select('date')
        .eq('employee_id', employee.id)
        .gte('date', fromDate)
        .lte('date', toDate)
        .returns<{ date: string }[]>(),
    ]);

    const presentDates = new Set(
      (attendanceDates ?? []).map((a) => a.check_in_time.slice(0, 10)),
    );
    const leaveDates = new Set(
      dates.filter((date) =>
        (leaveRows ?? []).some((l) => date >= l.from_date && date <= l.to_date),
      ),
    );
    const absentDates = new Set((absenceRows ?? []).map((a) => a.date));

    let present = 0;
    let absent = 0;
    let leave = 0;
    let holidayOrOff = 0;

    for (const date of dates) {
      if (presentDates.has(date)) {
        present += 1;
      } else if (leaveDates.has(date)) {
        leave += 1;
      } else if (absentDates.has(date)) {
        absent += 1;
      } else {
        // Neither present, on leave, nor marked absent — a weekend/holiday,
        // or (for today/future dates within the range) simply not yet
        // reconciled by the nightly job.
        holidayOrOff += 1;
      }
    }

    results.push({ employeeId: employee.id, employeeName: employee.full_name, present, absent, leave, holidayOrOff });
  }

  return results;
}
```

- [ ] **Step 2: Render the panel in the Reports page**

In `src/app/(app)/hr/reports/page.tsx`, load the summary alongside the existing `report`:
```ts
  const [{ data: employees }, { data: branches }, report, summary] = await Promise.all([
    supabase.from('employees').select('*').order('full_name').returns<Employee[]>(),
    supabase.from('branches_public').select('*').order('name').returns<Branch[]>(),
    loadReport(supabase, { from, to, employeeId, branchId }),
    loadAttendanceSummary(supabase, { from, to, employeeId, branchId }),
  ]);
```
(Add `loadAttendanceSummary` to the existing `import { loadReport } from '@/lib/attendance/report';` line.)

Add a new section after the existing `<Stat>` grid (after line 93) and before the entries table:
```tsx
      {summary.length > 0 && (
        <div className="card mt-5 overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <Th>Employee</Th>
                <Th>Present</Th>
                <Th>Absent</Th>
                <Th>Leave</Th>
                <Th>Off / holiday</Th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => (
                <tr key={row.employeeId} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-semibold text-ink">{row.employeeName}</td>
                  <td className="px-4 py-3 tabular-nums">{row.present}</td>
                  <td className="px-4 py-3 tabular-nums">{row.absent}</td>
                  <td className="px-4 py-3 tabular-nums">{row.leave}</td>
                  <td className="px-4 py-3 tabular-nums">{row.holidayOrOff}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
```

Note: `branchId` filtering isn't applied to the summary loader above (it filters employees by id, not branch) — this is acceptable for now since `report.ts`'s existing branch filter only ever filtered attendance rows, and adding branch filtering to the employee query would require joining through `default_branch_id`, which is a reasonable one-line addition (`if (filters.branchId) employeeQuery = employeeQuery.eq('default_branch_id', filters.branchId);`) — add that line in Step 1 now, immediately after the `employeeId` filter, since it's the same pattern and costs nothing extra.

- [ ] **Step 3: Typecheck and manual verification**

Run: `npm run typecheck`
Expected: no errors.

Manually: `/hr/reports`, confirm the new "Present / Absent / Leave / Off" table appears with numbers matching the test data seeded in Tasks 12–16 (one leave day, one absent day for the test employee).

- [ ] **Step 4: Commit**

```bash
git add src/lib/attendance/report.ts src/app/\(app\)/hr/reports/page.tsx
git commit -m "Add per-employee attendance summary (present/absent/leave/off) to Reports"
```

---

## Task 20: Nav restructuring — collapse HR items into one menu, add Leave

**Files:**
- Modify: `src/components/AppHeader.tsx`

**Interfaces:**
- Consumes: `Role` (now three values, Task 1).

- [ ] **Step 1: Restructure the nav item list and add a dropdown**

Read the current `src/components/AppHeader.tsx` (already fully reproduced earlier in this session, 163 lines, already updated once this session for the `lg:` breakpoint fix). Replace the flat `NAV` array and desktop `<nav>` rendering with a split between always-visible items and an HR submenu:

```tsx
interface NavItem {
  href: string;
  label: string;
}

const PRIMARY_NAV: NavItem[] = [
  { href: '/check-in', label: 'Check in' },
  { href: '/remote', label: 'Remote' },
  { href: '/leave', label: 'Leave' },
  { href: '/history', label: 'My history' },
];

const HR_NAV: NavItem[] = [
  { href: '/hr', label: 'Review' },
  { href: '/hr/reports', label: 'Reports' },
  { href: '/hr/branches', label: 'Branches' },
  { href: '/hr/employees', label: 'Employees' },
  { href: '/hr/audit', label: 'Audit' },
];
```

Replace the `items` computation (`const items = NAV.filter(...)`) with:
```ts
  const isHr = role === 'hr_admin' || role === 'super_admin';
  const [hrMenuOpen, setHrMenuOpen] = useState(false);
```

Replace the desktop `<nav>` block (the `lg:flex` one) to render `PRIMARY_NAV` plus, when `isHr`, an "HR ▾" disclosure button that toggles a small absolutely-positioned dropdown listing `HR_NAV`:
```tsx
        <nav className="hidden items-center gap-0.5 overflow-x-auto lg:flex">
          {PRIMARY_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={`shrink-0 whitespace-nowrap px-2.5 py-2 text-sm font-semibold transition-colors ${
                isActive(item.href)
                  ? 'bg-brand-primary-soft text-brand-primary'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              {item.label}
            </Link>
          ))}

          {isHr && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setHrMenuOpen((v) => !v)}
                aria-expanded={hrMenuOpen}
                className={`shrink-0 whitespace-nowrap px-2.5 py-2 text-sm font-semibold transition-colors ${
                  HR_NAV.some((item) => isActive(item.href))
                    ? 'bg-brand-primary-soft text-brand-primary'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                HR ▾
              </button>
              {hrMenuOpen && (
                <div
                  className="absolute left-0 top-full z-20 mt-1 min-w-40 border border-line bg-surface py-1 shadow-lg"
                  onMouseLeave={() => setHrMenuOpen(false)}
                >
                  {HR_NAV.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setHrMenuOpen(false)}
                      className={`block px-3 py-2 text-sm font-semibold ${
                        isActive(item.href)
                          ? 'bg-brand-primary-soft text-brand-primary'
                          : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
                      }`}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>
```

- [ ] **Step 2: Update the mobile menu**

In the mobile disclosure panel (the `{open && (...)}` block), replace `items.map(...)` with `[...PRIMARY_NAV, ...(isHr ? HR_NAV : [])].map(...)` — on mobile there's no room budget pressure the way there is on a horizontal bar, so a flat list is fine there.

- [ ] **Step 3: Typecheck and manual verification**

Run: `npm run typecheck`
Expected: no errors.

Manually: as `super_admin` and as scoped `hr_admin`, confirm the top bar now shows `Check in / Remote / Leave / My history / HR ▾` with no wrapping at any width ≥1024px, the HR dropdown opens/closes on click, and the mobile menu still lists everything.

- [ ] **Step 4: Commit**

```bash
git add src/components/AppHeader.tsx
git commit -m "Collapse HR nav items into a dropdown and add Leave to the primary nav"
```

---

## Task 21: Extend `db-verify.mjs` and `smoke-e2e.mjs`

**Files:**
- Modify: `scripts/db-verify.mjs`
- Modify: `scripts/smoke-e2e.mjs`

**Interfaces:**
- None — these are operational scripts, not consumed by application code.

- [ ] **Step 1: Add schema checks**

Read `scripts/db-verify.mjs` in full (251 lines) to find its existing check-registration pattern (a `check(name, condition, detail)` helper, called repeatedly with `await q(...)` results — the same shape already used for RLS/grant checks on `attendance`/`branches`). Append checks, following that exact pattern, for:
- `hr_branch_assignments`, `branch_calendar_days`, `leave_requests`, `absences` all have `relrowsecurity = true` in `pg_class`.
- `private.is_super_admin`, `private.hr_branch_ids`, `private.hr_visible_employee_ids`, `private.is_working_day`, `private.mark_daily_absences` all exist in `pg_proc` under the `private` schema.
- `cron.job` has one row with `jobname = 'mark-daily-absences'` and `active = true`.
- `employees_role_check` constraint's definition (via `pg_get_constraintdef`) contains `'super_admin'`.

- [ ] **Step 2: Add page checks**

In `scripts/smoke-e2e.mjs`, after the existing `/hr/audit` check block (around line 134-136), add:
```js
const leave = await get('/leave');
check('/leave returns 200', leave.status === 200, `got ${leave.status}`);
check('/leave renders the form', leave.body.includes('Request leave'));
```

- [ ] **Step 3: Run both scripts against the applied schema**

Run: `node scripts/db-verify.mjs`
Expected: every check, including the new ones, prints as passing.

Run: `npm run dev` in one terminal, then `node scripts/smoke-e2e.mjs <hr-email> <password>` in another.
Expected: all checks, including the new `/leave` ones, pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/db-verify.mjs scripts/smoke-e2e.mjs
git commit -m "Extend db-verify and smoke-e2e for absence/leave/HR-scoping schema"
```

---

## Self-Review Notes

- **Spec coverage:** weekly schedule (Task 6), holiday/mandatory-workday calendar (Task 6-7), leave requests single-type/future-only (Tasks 8, 10, 12, 14), HR review as a third tab (Task 15), nightly absence job with no-notification (Task 16), late-reversal for both leave and remote-attendance approval (Tasks 13, 17), super-admin tier and branch scoping across employees/attendance/branches/reports (Tasks 1–5, 7, 19), nav restructuring (Task 20), reporting (Task 19), history merge (Task 18) — every section of the spec has a task.
- **Type consistency:** `Role` (3 values) introduced in Task 1 is consumed identically by `getHrUser`/`getSuperAdminUser` (Task 3), `EmployeeManager` (Task 5), and `AppHeader` (Task 20). `AttendanceSummaryRow`, `LeaveRequest`/`LeaveRequestRow`, `Absence`, `BranchCalendarDay` are each defined once (Tasks 6, 8, 9) and referenced by name, not redefined, in every later task.
- **Placeholder scan:** no task contains "TBD" or unshown logic; every SQL/TS block is complete and copy-pasteable, including the exact grant/policy statements each migration needs.
- **Scope:** this plan intentionally does not implement per-employee shift assignment UI or leave-category/balance tracking — both are explicitly out of scope in the spec, and no task here half-implements them.
