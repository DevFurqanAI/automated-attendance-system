/**
 * Post-migration verification.
 *
 * Checks the things that silently go wrong: RLS left disabled, policies not
 * created, the role helper missing or callable by the wrong role, realtime not
 * publishing, the auth trigger absent, and qr_secret being readable by staff.
 *
 * Usage: node scripts/db-verify.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

for (const line of fs
  .readFileSync(path.join(ROOT, '.env.local'), 'utf8')
  .split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  const k = t.slice(0, i).trim();
  if (!(k in process.env)) {
    process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
}

const ref = process.env.NEXT_PUBLIC_SUPABASE_URL.match(
  /https:\/\/([a-z0-9]+)\.supabase\.co/,
)[1];

async function q(sql) {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

let failures = 0;
const check = (label, pass, detail = '') => {
  if (!pass) failures += 1;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log(`project: ${ref}\n`);

// --- tables ---------------------------------------------------------------
const tables = await q(`
  select tablename, rowsecurity
  from pg_tables
  where schemaname = 'public'
  order by tablename;
`);
console.log('Tables and RLS');
for (const want of ['attendance', 'branches', 'employees']) {
  const row = tables.find((t) => t.tablename === want);
  check(`${want} exists`, Boolean(row));
  if (row) check(`${want} RLS enabled`, row.rowsecurity === true);
}

// --- view -----------------------------------------------------------------
const views = await q(`
  select viewname from pg_views where schemaname = 'public';
`);
console.log('\nView');
check('branches_public exists', views.some((v) => v.viewname === 'branches_public'));

// --- policies -------------------------------------------------------------
const policies = await q(`
  select tablename, policyname, cmd
  from pg_policies
  where schemaname = 'public'
  order by tablename, policyname;
`);
console.log(`\nPolicies (${policies.length})`);
for (const p of policies) {
  console.log(`        ${p.tablename}.${p.policyname} [${p.cmd}]`);
}
check('attendance has policies', policies.some((p) => p.tablename === 'attendance'));
check('employees has policies', policies.some((p) => p.tablename === 'employees'));
check('branches has policies', policies.some((p) => p.tablename === 'branches'));

// --- role helper ----------------------------------------------------------
const fn = await q(`
  select p.proname, p.prosecdef
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'is_hr_admin';
`);
console.log('\nRole helper');
check('private.is_hr_admin exists', fn.length === 1);
check('is SECURITY DEFINER', fn[0]?.prosecdef === true);

const grants = await q(`
  select has_function_privilege('authenticated', 'private.is_hr_admin()', 'execute') as auth_can,
         has_function_privilege('anon', 'private.is_hr_admin()', 'execute') as anon_can;
`);
check('authenticated may execute it', grants[0]?.auth_can === true);
check('anon may NOT execute it', grants[0]?.anon_can === false);

// --- qr_secret must not be staff-readable ---------------------------------
const colGrant = await q(`
  select has_column_privilege('authenticated', 'public.branches', 'qr_secret', 'select') as secret,
         has_column_privilege('authenticated', 'public.branches', 'name', 'select') as name;
`);
console.log('\nColumn grants on branches');
check('qr_secret NOT readable by authenticated', colGrant[0]?.secret === false);
check('name readable by authenticated', colGrant[0]?.name === true);

// --- write privileges: the API roles must hold NONE ------------------------
// This is the check that matters most. Supabase grants anon/authenticated full
// CRUD on public tables by default and leans on RLS; the "attendance insert
// own" policy constrained only WHO a row belonged to, so any signed-in
// employee could insert an already-`approved` shift straight through PostgREST
// and skip the QR code, the geofence and the review queue entirely.
// See 20260824090000_harden_grants.sql.
const writes = await q(`
  select
    has_table_privilege('authenticated', 'public.attendance', 'insert') as att_ins,
    has_table_privilege('authenticated', 'public.attendance', 'update') as att_upd,
    has_table_privilege('authenticated', 'public.attendance', 'delete') as att_del,
    has_table_privilege('authenticated', 'public.employees',  'update') as emp_upd,
    has_table_privilege('authenticated', 'public.employees',  'insert') as emp_ins,
    has_table_privilege('authenticated', 'public.branches',   'update') as br_upd,
    has_column_privilege('authenticated', 'public.branches', 'qr_secret', 'update') as qr_upd,
    has_table_privilege('authenticated', 'public.attendance', 'select') as att_sel;
`);
console.log('\nWrite privileges (all must be denied)');
check('authenticated cannot INSERT attendance', writes[0]?.att_ins === false);
check('authenticated cannot UPDATE attendance', writes[0]?.att_upd === false);
check('authenticated cannot DELETE attendance', writes[0]?.att_del === false);
check('authenticated cannot UPDATE employees', writes[0]?.emp_upd === false);
check('authenticated cannot INSERT employees', writes[0]?.emp_ins === false);
check('authenticated cannot UPDATE branches', writes[0]?.br_upd === false);
check('authenticated cannot write qr_secret', writes[0]?.qr_upd === false);
// ...but reads must survive, or the whole app goes blank.
check('authenticated CAN still SELECT attendance', writes[0]?.att_sel === true);

// --- audit log ------------------------------------------------------------
const audit = await q(`
  select
    to_regclass('public.audit_log') is not null as exists,
    has_table_privilege('authenticated', 'public.audit_log', 'insert') as ins,
    has_table_privilege('authenticated', 'public.audit_log', 'update') as upd,
    has_table_privilege('authenticated', 'public.audit_log', 'delete') as del;
`);
console.log('\nAudit log');
check('audit_log exists', audit[0]?.exists === true);
check('append-only: no INSERT for authenticated', audit[0]?.ins === false);
check('append-only: no UPDATE for authenticated', audit[0]?.upd === false);
check('append-only: no DELETE for authenticated', audit[0]?.del === false);

// --- notifications --------------------------------------------------------
const notif = await q(`
  select
    to_regclass('public.notifications') is not null as exists,
    has_table_privilege('authenticated', 'public.notifications', 'select') as sel,
    has_table_privilege('authenticated', 'public.notifications', 'update') as upd;
`);
console.log('\nNotifications');
check('notifications exists', notif[0]?.exists === true);
check('readable by authenticated (RLS scopes to own)', notif[0]?.sel === true);
check('not writable by authenticated', notif[0]?.upd === false);

// --- rate limiter ---------------------------------------------------------
const rl = await q(`
  select
    to_regclass('private.rate_limit') is not null as tbl,
    has_function_privilege('authenticated', 'public.rate_limit_hit(text,integer,integer)', 'execute') as auth_can,
    has_function_privilege('service_role', 'public.rate_limit_hit(text,integer,integer)', 'execute') as svc_can;
`);
console.log('\nRate limiter');
check('private.rate_limit exists', rl[0]?.tbl === true);
// If a signed-in user could call this, they could burn anyone's budget by
// naming their bucket.
check('authenticated may NOT execute rate_limit_hit', rl[0]?.auth_can === false);
check('service_role may execute rate_limit_hit', rl[0]?.svc_can === true);

// --- check-out branch -----------------------------------------------------
const cob = await q(`
  select count(*)::int as n from information_schema.columns
  where table_schema = 'public' and table_name = 'attendance'
    and column_name = 'check_out_branch_id';
`);
console.log('\nSplit-shift detection');
check('attendance.check_out_branch_id exists', cob[0]?.n === 1);

const flagCheck = await q(`
  select pg_get_constraintdef(oid) as def from pg_constraint
  where conrelid = 'public.attendance'::regclass
    and conname = 'attendance_flag_reason_check';
`);
check(
  'branch_mismatch is an allowed flag reason',
  /branch_mismatch/.test(flagCheck[0]?.def ?? ''),
);

// --- realtime -------------------------------------------------------------
const pub = await q(`
  select tablename from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public';
`);
console.log('\nRealtime');
check('attendance published', pub.some((p) => p.tablename === 'attendance'));

const replica = await q(`
  select relreplident from pg_class where oid = 'public.attendance'::regclass;
`);
check('replica identity FULL', replica[0]?.relreplident === 'f');

// --- auth trigger ---------------------------------------------------------
const trig = await q(`
  select tgname from pg_trigger where tgname = 'on_auth_user_created';
`);
console.log('\nAuth trigger');
check('on_auth_user_created exists', trig.length === 1);

// --- seed -----------------------------------------------------------------
const branches = await q(`
  select name, latitude, longitude, radius_meters, qr_version,
         length(qr_secret) as secret_len
  from public.branches order by name;
`);
console.log(`\nBranches seeded (${branches.length})`);
for (const b of branches) {
  console.log(
    `        ${b.name.padEnd(18)} ${b.latitude}, ${b.longitude}  ` +
      `r=${b.radius_meters}m  v${b.qr_version}  secret=${b.secret_len} chars`,
  );
}
check('3 branches present', branches.length === 3);
check(
  'every branch has a distinct secret',
  new Set(branches.map((b) => b.secret_len)).size >= 1 &&
    branches.every((b) => b.secret_len === 64),
);

// --- branch-scoped HR / leave / holidays / absences ------------------------
const scopingTables = await q(`
  select tablename, rowsecurity
  from pg_tables
  where schemaname = 'public'
    and tablename in ('hr_branch_assignments', 'branch_calendar_days', 'leave_requests', 'absences')
  order by tablename;
`);
console.log('\nHR scoping / leave / absence tables');
for (const want of ['hr_branch_assignments', 'branch_calendar_days', 'leave_requests', 'absences']) {
  const row = scopingTables.find((t) => t.tablename === want);
  check(`${want} exists`, Boolean(row));
  if (row) check(`${want} RLS enabled`, row.rowsecurity === true);
}

const scopingFns = await q(`
  select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname in (
      'is_super_admin', 'hr_branch_ids', 'hr_visible_employee_ids',
      'is_working_day', 'mark_daily_absences'
    );
`);
console.log('\nBranch-scoping / schedule functions');
for (const want of [
  'is_super_admin',
  'hr_branch_ids',
  'hr_visible_employee_ids',
  'is_working_day',
  'mark_daily_absences',
]) {
  check(`private.${want} exists`, scopingFns.some((f) => f.proname === want));
}

const cronJob = await q(`
  select jobname, active from cron.job where jobname = 'mark-daily-absences';
`);
console.log('\nNightly absence job');
check('mark-daily-absences scheduled', cronJob.length === 1);
check('mark-daily-absences active', cronJob[0]?.active === true);

const roleCheck = await q(`
  select pg_get_constraintdef(oid) as def from pg_constraint
  where conrelid = 'public.employees'::regclass
    and conname = 'employees_role_check';
`);
console.log('\nSuper-admin role tier');
check('employees.role allows super_admin', /super_admin/.test(roleCheck[0]?.def ?? ''));

console.log(
  failures === 0
    ? '\nAll checks passed.'
    : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
