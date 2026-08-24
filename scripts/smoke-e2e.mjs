/**
 * End-to-end smoke test against a running server.
 *
 * Signs in for real, builds the session cookie exactly the way @supabase/ssr
 * writes it, then requests each page as a signed-in HR admin and asserts on the
 * rendered HTML. This exercises the whole stack: Supabase Auth → the proxy's
 * session refresh → server components → RLS → PostgREST.
 *
 * Usage: node scripts/smoke-e2e.mjs <email> <password> [baseUrl]
 */
import { createClient } from '@supabase/supabase-js';
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

const [email, password, baseUrl = 'http://localhost:3000'] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: node scripts/smoke-e2e.mjs <email> <password> [baseUrl]');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)[1];

/** Mirrors @supabase/ssr: `base64-<b64 json>`, split at MAX_CHUNK_SIZE. */
const MAX_CHUNK_SIZE = 3180;

function buildCookieHeader(session) {
  const name = `sb-${ref}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString('base64')}`;

  if (value.length <= MAX_CHUNK_SIZE) return `${name}=${encodeURIComponent(value)}`;

  const chunks = [];
  for (let i = 0; i < value.length; i += MAX_CHUNK_SIZE) {
    chunks.push(value.slice(i, i + MAX_CHUNK_SIZE));
  }
  return chunks
    .map((c, i) => `${name}.${i}=${encodeURIComponent(c)}`)
    .join('; ');
}

let failures = 0;
function check(label, pass, detail = '') {
  if (!pass) failures += 1;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

const supabase = createClient(url, publishable, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase.auth.signInWithPassword({ email, password });
if (error) {
  console.error(`Sign-in failed: ${error.message}`);
  process.exit(1);
}

const cookie = buildCookieHeader(data.session);
console.log(`signed in as ${email}\ncookie chunks: ${cookie.split('; ').length}\n`);

async function get(path) {
  const r = await fetch(`${baseUrl}${path}`, {
    headers: { cookie },
    redirect: 'manual',
  });
  return { status: r.status, body: await r.text(), headers: r.headers };
}

console.log('Authenticated pages');

const home = await get('/');
check('/ returns 200 (not redirected to login)', home.status === 200, `got ${home.status}`);
check('/ greets the signed-in user', home.body.includes('Hello,'));
check('/ shows the HR queue card', home.body.includes('HR review queue'));

const checkIn = await get('/check-in');
check('/check-in returns 200', checkIn.status === 200, `got ${checkIn.status}`);
check('/check-in offers a scan', checkIn.body.includes('Scan to check in'));

const remote = await get('/remote');
check('/remote returns 200', remote.status === 200, `got ${remote.status}`);
// React splits interpolated values with <!-- --> markers, so match the static
// copy either side of the number rather than the rendered sentence.
check(
  '/remote states the claim window',
  remote.body.includes('cannot claim work more than') &&
    remote.body.includes('days ago'),
);

const history = await get('/history');
check('/history returns 200', history.status === 200, `got ${history.status}`);

const leave = await get('/leave');
check('/leave returns 200', leave.status === 200, `got ${leave.status}`);
check('/leave renders the form', leave.body.includes('Request leave'));

console.log('\nHR pages');

const hr = await get('/hr');
check('/hr returns 200', hr.status === 200, `got ${hr.status}`);
check('/hr renders the review queue', hr.body.includes('Review queue'));

const branchesPage = await get('/hr/branches');
check('/hr/branches returns 200', branchesPage.status === 200, `got ${branchesPage.status}`);

// Read the expected names from the database rather than hardcoding them, so
// this stays correct when branches are renamed or moved.
const { data: allBranches } = await supabase
  .from('branches_public')
  .select('name')
  .order('name');

check('at least one branch is configured', (allBranches?.length ?? 0) > 0);
for (const { name } of allBranches ?? []) {
  check(`/hr/branches lists ${name}`, branchesPage.body.includes(name));
}

const employees = await get('/hr/employees');
check('/hr/employees returns 200', employees.status === 200, `got ${employees.status}`);
check('/hr/employees lists the admin', employees.body.includes(email));

const reports = await get('/hr/reports');
check('/hr/reports returns 200', reports.status === 200, `got ${reports.status}`);
check('/hr/reports renders totals', reports.body.includes('Total hours'));

const audit = await get('/hr/audit');
check('/hr/audit returns 200', audit.status === 200, `got ${audit.status}`);
check('/hr/audit renders the log', audit.body.includes('Audit log'));

const notifications = await get('/notifications');
check('/notifications returns 200', notifications.status === 200, `got ${notifications.status}`);
check('/notifications renders', notifications.body.includes('Notifications'));

console.log('\nQR code generation');

// Pull a branch id straight from the DB to request its printable code.
const { data: branchRows } = await supabase
  .from('branches_public')
  .select('id, name')
  .order('name');

const branch = branchRows?.[0];
const qr = await fetch(`${baseUrl}/api/hr/branches/${branch.id}/qr`, {
  headers: { cookie },
});
const qrBuf = Buffer.from(await qr.arrayBuffer());
check('QR endpoint returns 200', qr.status === 200, `got ${qr.status}`);
check('returns a PNG', qr.headers.get('content-type') === 'image/png');
check('PNG has a valid signature', qrBuf.subarray(1, 4).toString() === 'PNG');
check('PNG is non-trivial', qrBuf.length > 1000, `${qrBuf.length} bytes`);
check('is not cached', /no-store/.test(qr.headers.get('cache-control') ?? ''));

console.log('\nCSV export');

const now = new Date();
const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
const csv = await fetch(
  `${baseUrl}/api/hr/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  { headers: { cookie } },
);
const csvText = await csv.text();
check('CSV endpoint returns 200', csv.status === 200, `got ${csv.status}`);
check('is an attachment', /attachment/.test(csv.headers.get('content-disposition') ?? ''));
check('has the expected header row', csvText.includes('Employee,Email,Branch,Method'));

console.log('\nServer-side claim-window enforcement (bypassing the form)');

const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
const rejected = await fetch(`${baseUrl}/api/attendance/remote`, {
  method: 'POST',
  headers: { cookie, 'Content-Type': 'application/json' },
  body: JSON.stringify({ reason: 'Client visit', claimedCheckIn: threeDaysAgo }),
});
const rejectedBody = await rejected.json();
check('a 3-day-old claim is rejected', rejected.status === 400, `got ${rejected.status}`);
check(
  'the error names the 2-day rule',
  /2 days/.test(rejectedBody.error ?? ''),
  rejectedBody.error,
);

const yesterday = new Date(Date.now() - 26 * 3_600_000).toISOString();
const accepted = await fetch(`${baseUrl}/api/attendance/remote`, {
  method: 'POST',
  headers: { cookie, 'Content-Type': 'application/json' },
  body: JSON.stringify({ reason: 'Client visit', claimedCheckIn: yesterday }),
});
const acceptedBody = await accepted.json();
check('a 26-hour-old claim is accepted', accepted.status === 200, `got ${accepted.status}`);
check('it lands as pending', acceptedBody.status === 'pending');

// The whole point: a pending claim must not count anywhere.
const csv2 = await fetch(
  `${baseUrl}/api/hr/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  { headers: { cookie } },
);
const csv2Text = await csv2.text();
check(
  'the pending claim does NOT appear in the report',
  !csv2Text.includes('Client visit'),
);

console.log('\nUnverifiable QR token is refused');
const badToken = await fetch(`${baseUrl}/api/attendance/check-in`, {
  method: 'POST',
  headers: { cookie, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    token: 'attn1.eyJiIjoiZmFrZSIsInYiOjF9.bm90YXJlYWxzaWduYXR1cmU',
    lat: 51.5074,
    lng: -0.1278,
    accuracy: 10,
  }),
});
check('forged token rejected', badToken.status === 400, `got ${badToken.status}`);

console.log('\nEmailed-link flow (anonymous)');

/** Same as get(), but with no session cookie — as a mail client arrives. */
async function getAnon(path) {
  const r = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
  return {
    status: r.status,
    location: r.headers.get('location') ?? '',
    body: r.status === 200 ? await r.text() : '',
  };
}

const confirmBare = await getAnon('/auth/confirm');
check(
  '/auth/confirm without a token redirects',
  confirmBare.status === 307 || confirmBare.status === 302,
  `got ${confirmBare.status}`,
);
check(
  'it says the link was incomplete',
  confirmBare.location.includes('/login?error=link_incomplete'),
  confirmBare.location,
);

const confirmBad = await getAnon('/auth/confirm?token_hash=not-a-real-hash&type=invite');
check(
  'a forged token_hash is refused',
  confirmBad.location.includes('/login?error=link_invalid'),
  confirmBad.location,
);

// An open redirect here would let a phishing link borrow the real domain.
const confirmEvil = await getAnon(
  '/auth/confirm?token_hash=x&type=invite&next=https://evil.example.com',
);
check(
  'an absolute `next` cannot escape the site',
  !confirmEvil.location.includes('evil.example.com'),
  confirmEvil.location,
);

const setPassword = await getAnon('/auth/set-password');
check(
  '/auth/set-password is not reachable without a session',
  setPassword.location.includes('/login'),
  `${setPassword.status} ${setPassword.location}`,
);

// Where Supabase's stock (free-tier) email links land. It has to render for
// anonymous visitors: the session is in the fragment, which only the browser
// can see, so the server necessarily treats this request as signed out.
const callback = await getAnon('/auth/callback');
check('/auth/callback returns 200 anonymously', callback.status === 200, `got ${callback.status}`);
check('it shows a signing-in state', callback.body.includes('Signing you in'));

const forgot = await getAnon('/auth/forgot-password');
check('/auth/forgot-password returns 200', forgot.status === 200, `got ${forgot.status}`);
check('it asks for the work email', forgot.body.includes('Work email'));

const loginPage = await getAnon('/login?error=link_invalid');
check('/login returns 200', loginPage.status === 200, `got ${loginPage.status}`);
check(
  'the login page explains a dead link',
  loginPage.body.includes('already been used'),
);
check(
  'and offers a password reset',
  loginPage.body.includes('/auth/forgot-password'),
);

// Clean up the row this test created so the review queue starts empty.
if (acceptedBody.id) {
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await admin.from('attendance').delete().eq('id', acceptedBody.id);
  console.log('\n(cleaned up the test remote request)');
}

console.log(
  failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
