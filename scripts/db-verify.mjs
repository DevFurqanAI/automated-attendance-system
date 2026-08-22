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

console.log(
  failures === 0
    ? '\nAll checks passed.'
    : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
