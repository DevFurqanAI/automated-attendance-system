/**
 * Creates the first HR administrator and verifies the full auth + RLS chain.
 *
 * The app deliberately offers no way to promote yourself to hr_admin, so the
 * first one has to be made out-of-band. After this, promote everyone else from
 * HR → Employees.
 *
 * Usage:
 *   node scripts/bootstrap-admin.mjs <email> [full name]
 *
 * Safe to re-run: if the user already exists it is promoted rather than
 * recreated, and no password is changed.
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  const k = t.slice(0, i).trim();
  if (!(k in process.env)) {
    process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

const email = process.argv[2];
const fullName = process.argv[3] || email?.split('@')[0];

if (!email) {
  console.error('Usage: node scripts/bootstrap-admin.mjs <email> [full name]');
  process.exit(1);
}

const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Strong enough that it does not matter, since it is changed on first use. */
function generatePassword() {
  return `${randomBytes(15).toString('base64url')}Aa1!`;
}

let password = null;

// --- 1. Create or find the auth user --------------------------------------
const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
let user = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());

if (user) {
  console.log(`auth user   : already exists (${user.id})`);
} else {
  password = generatePassword();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no SMTP round-trip needed for the bootstrap account
    user_metadata: { full_name: fullName },
  });
  if (error) {
    console.error(`FAILED to create user: ${error.message}`);
    process.exit(1);
  }
  user = data.user;
  console.log(`auth user   : created (${user.id})`);
}

// --- 2. Ensure the employees row exists and is hr_admin -------------------
// The on_auth_user_created trigger should have made it; upsert defensively in
// case the user pre-dates the trigger.
const { error: upsertError } = await admin.from('employees').upsert(
  {
    id: user.id,
    full_name: fullName,
    email,
    role: 'hr_admin',
    active: true,
  },
  { onConflict: 'id' },
);

if (upsertError) {
  console.error(`FAILED to write employees row: ${upsertError.message}`);
  process.exit(1);
}

const { data: employee } = await admin
  .from('employees')
  .select('id, full_name, email, role, active')
  .eq('id', user.id)
  .single();

console.log(
  `employee    : ${employee.full_name} <${employee.email}> role=${employee.role} active=${employee.active}`,
);

// --- 3. Verify the chain end-to-end as a real signed-in client -------------
if (password) {
  console.log('\nVerifying sign-in and RLS as this user…');

  const asUser = createClient(url, publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: session, error: signInError } =
    await asUser.auth.signInWithPassword({ email, password });

  if (signInError) {
    console.error(`  FAIL sign-in: ${signInError.message}`);
    process.exit(1);
  }
  console.log('  PASS sign-in with the publishable key');

  const { data: me } = await asUser
    .from('employees')
    .select('role')
    .eq('id', session.user.id)
    .single();
  console.log(
    me?.role === 'hr_admin'
      ? '  PASS reads own employees row, role=hr_admin'
      : `  FAIL role came back as ${me?.role}`,
  );

  const { data: branches } = await asUser
    .from('branches_public')
    .select('name')
    .order('name');
  console.log(
    branches?.length === 3
      ? `  PASS reads branches_public (${branches.map((b) => b.name).join(', ')})`
      : `  FAIL branches_public returned ${branches?.length ?? 0} rows`,
  );

  // qr_secret must be unreadable even for HR through the Data API.
  const { error: secretError } = await asUser
    .from('branches')
    .select('qr_secret')
    .limit(1);
  console.log(
    secretError
      ? '  PASS qr_secret is rejected by the Data API'
      : '  FAIL qr_secret was readable through the Data API',
  );

  await asUser.auth.signOut();
}

console.log('\n─────────────────────────────────────────────');
if (password) {
  console.log('  Sign in with:');
  console.log(`    email    : ${email}`);
  console.log(`    password : ${password}`);
  console.log('\n  CHANGE THIS PASSWORD after your first sign-in.');
} else {
  console.log(`  ${email} was already registered and is now hr_admin.`);
  console.log('  Its existing password is unchanged.');
}
console.log('─────────────────────────────────────────────');
