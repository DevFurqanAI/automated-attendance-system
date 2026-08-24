# Absence tracking, leave requests, holidays, and branch-scoped HR — design

Status: approved by user, proceeding to implementation plan.

## Problem

Today the system only records presence: a row in `attendance` exists only
when someone actively checks in or submits a remote request. There is no
concept of an expected work schedule, so:

- An employee who simply never shows up is indistinguishable from a
  weekend or a holiday — nothing is recorded, nothing is flagged.
- There is no way to request or approve leave.
- There is no holiday calendar, and no way for HR to declare a special
  mandatory workday on what would normally be an off day.
- All HR admins currently see every branch. In reality there are 2 HR
  admins today: one manages only the main branch, the other manages two
  branches — and this needs to be enforced, not just informal.

This spec covers all of the above as one connected change, since the
absence/leave/holiday model and the HR branch-scoping model both touch
the same review queues, reports, and RLS policies.

## Data model

### Weekly schedule

- `branches.weekly_off_days smallint[] not null default '{0}'` — 0=Sunday
  … 6=Saturday. Each branch sets its own default off days.
- `employees.weekly_off_days smallint[]` — nullable override. `null`
  means "inherit from the employee's branch." This column exists now so
  a future part-time/shift employee can get an individual schedule
  without a schema change later; nothing else in this spec populates it.

### Calendar overrides

`branch_calendar_days`:

| column     | type        | notes                                    |
|------------|-------------|-------------------------------------------|
| id         | uuid pk     |                                            |
| branch_id  | uuid fk     | references `branches`                     |
| date       | date        |                                            |
| kind       | text        | `holiday` \| `mandatory_workday`          |
| label      | text        | e.g. "Eid", "Inventory count day"         |

Unique on `(branch_id, date)`.

### Leave requests

`leave_requests`:

| column         | type        | notes                                   |
|----------------|-------------|-------------------------------------------|
| id             | uuid pk     |                                            |
| employee_id    | uuid fk     |                                            |
| from_date      | date        |                                            |
| to_date        | date        | `>= from_date`                            |
| reason         | text        |                                            |
| status         | text        | `pending` \| `approved` \| `declined`     |
| reviewed_by    | uuid fk     | nullable                                  |
| reviewed_at    | timestamptz | nullable                                  |
| created_at     | timestamptz | default now()                             |

Single generic leave type (no categories, no balance tracking).
`from_date` must be `>= current_date` at insert time (enforced in the API
route, mirroring how `attendance`/`remote` routes validate today).

### Absences

`absences`:

| column      | type        | notes                                  |
|-------------|-------------|------------------------------------------|
| id          | uuid pk     |                                          |
| employee_id | uuid fk     |                                          |
| branch_id   | uuid fk     | the employee's branch at the time       |
| date        | date        |                                          |
| created_at  | timestamptz | default now()                           |

Unique on `(employee_id, date)`. Rows are only ever inserted by the
nightly job (Section "Nightly absence job") and only ever deleted by the
late-reversal path — never computed ad hoc elsewhere, so "is this person
marked absent" always has one source of truth.

### HR branch scoping

- `employees.role` gains a third value: `employee` | `hr_admin` |
  `super_admin`.
- `hr_branch_assignments (hr_admin_id uuid fk, branch_id uuid fk)`,
  primary key `(hr_admin_id, branch_id)`. Editable only by
  `super_admin`.
- `arshadfurqan031@gmail.com` is promoted to `super_admin` as part of
  this change's migration (one-off, same pattern as the existing
  admin-promotion script).

## Resolving a date's status

`private.is_working_day(employee_id, date) returns boolean`, precedence
high to low:

1. `branch_calendar_days.kind = 'mandatory_workday'` for that
   branch/date → working day.
2. `branch_calendar_days.kind = 'holiday'` for that branch/date → off.
3. Weekday in `employees.weekly_off_days` (if set) else the employee's
   branch's `weekly_off_days` → off if present, else working.

Used by both the nightly absence job and by reporting queries, so the
rule lives in exactly one place.

## Leave request workflow

- Employee-facing `/leave` page (same shape as `/remote`): from/to date,
  reason, submit. Future/today only.
- Shows up in "My history" merged into the existing table (a `leave`
  method/row type).
- HR review: a third tab, **Leave**, added to the existing
  `ReviewDashboard` (`/hr`), next to Pending/Flagged. Same
  approve/decline pattern, same Realtime subscription extended to
  `leave_requests`.
- On approval: any `absences` row whose date falls within
  `[from_date, to_date]` for that employee is deleted, with an
  `audit_log` entry recording the reversal (append-only log, same as
  every other mutation in this system). On decline: no side effect.
- Notifications (reusing `notify.ts`): submission notifies the
  HR admin(s) assigned to the employee's branch (or all HR admins if the
  employee has no `default_branch_id`), plus always `super_admin`s.
  Approval/decline notifies the employee. No notification is sent for
  nightly-job-marked absences — HR checks reports for that.

## Nightly absence job

`private.mark_daily_absences()`, run via `pg_cron` at **21:00 UTC**
(02:00 AM PKT — comfortably after midnight so a late checkout can't be
caught mid-shift), evaluating the Asia/Karachi calendar day that just
ended:

For each active employee, for the target date:

1. Skip if `is_working_day(employee, date)` is false.
2. Skip if any `attendance` row exists for that employee with a
   check-in on that date, regardless of status (approved/pending/
   flagged) — showing up at all means not absent, even pre-review.
3. Skip if an approved `leave_requests` row covers that date.
4. Otherwise insert into `absences`.

No notification is sent (per explicit decision — HR checks this via
reports, not push notifications).

## HR branch scoping

Scoping rule, applied to the Review queue, Reports, Audit log, and
Employee list:

- `super_admin` → unfiltered.
- `hr_admin` → only employees whose `default_branch_id` is in
  `private.hr_branch_ids()` (their assigned branches), **plus** any
  employee with `default_branch_id is null`.

Branch creation and `hr_branch_assignments` writes are `super_admin`
only. A scoped `hr_admin` can still edit the weekly-off-days/calendar
for branches assigned to them (Section "Weekly schedule" /
"Calendar overrides"), but not create branches or reassign HR coverage.

Employee management (`/hr/employees`): role changes and
`default_branch_id` reassignment are `super_admin` only. A scoped
`hr_admin` retains day-to-day management (e.g. attendance corrections)
for employees in their branches, per the existing employee-management
protections already in the codebase.

RLS implementation mirrors the existing `private.is_hr_admin()` pattern:
add `private.is_super_admin()` and `private.hr_branch_ids()` (SECURITY
DEFINER, unexposed `private` schema), and rewrite the relevant policies
on `attendance`, `leave_requests`, `absences`, and `employees` to:

```sql
private.is_super_admin()
or (
  private.is_hr_admin()
  and (target.default_branch_id in (select private.hr_branch_ids())
       or target.default_branch_id is null)
)
```

## Reporting & UI

- `/hr/reports` gains an **Attendance summary** panel: per employee, per
  selected range, counts of Present / Absent / Leave / Holiday / Off —
  computed from `is_working_day()` plus `attendance`, `leave_requests`,
  `absences`. The existing hours/payroll table is unchanged, just
  filtered by HR branch scope like every other HR view.
- `/history` (employee-facing) merges leave and absence rows into the
  existing attendance table rather than a separate list.
- No change to employee-facing check-in/remote/leave flows — those
  already scope to `auth.uid()` and are unaffected by HR branch scoping.

## Navigation restructuring

Adding `/leave` brings the signed-in nav to 9 items for an `hr_admin`
(Check in, Remote, Leave, My history, Review, Reports, Branches,
Employees, Audit) — too many for a flat top-level bar at any width. The
5 HR-only items collapse into a single **HR** dropdown/disclosure menu
in `AppHeader`, so the top-level bar becomes: Check in, Remote, Leave,
My history, HR ▾ (opens Review / Reports / Branches / Employees /
Audit). A `super_admin` sees the same HR menu, since they're a superset
of `hr_admin` capabilities. This is implemented as part of this change,
not deferred.

## Out of scope (explicitly deferred)

- Leave categories/types and yearly balance tracking (single generic
  leave type only, per decision).
- Per-employee shift assignment / part-time scheduling UI (the
  `employees.weekly_off_days` column exists for this, but no UI or
  logic populates or uses it beyond inheritance-from-branch yet).
- Absence notifications to HR.
- Retroactive (past-dated) leave requests.
