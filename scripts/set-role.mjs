/**
 * Changes an employee's role out-of-band.
 *
 * The app deliberately refuses to let one HR administrator demote another:
 * a flat tier where every admin can remove every other admin has no safe
 * resting state, and the likeliest accident is promoting a colleague who then
 * demotes you. So removing an administrator requires the service-role key —
 * i.e. whoever administers the database, not merely whoever is signed in.
 *
 * Promoting to hr_admin is available here too, but HR → Employees does that
 * perfectly well; this is mainly the way back down.
 *
 * Usage:
 *   node scripts/set-role.mjs <email> employee
 *   node scripts/set-role.mjs <email> hr_admin
 *   node scripts/set-role.mjs <email> employee --reason "left the company"
 *
 * Refuses to demote the last active HR administrator — that would lock
 * everyone out of the review dashboard with no way back except this script and
 * a lucky guess at who to promote.
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

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const reasonIndex = args.indexOf('--reason');
const reason = reasonIndex === -1 ? null : args[reasonIndex + 1];

const [email, role] = positional;

if (!email || !['employee', 'hr_admin', 'super_admin'].includes(role)) {
  console.error(
    'Usage: node scripts/set-role.mjs <email> <employee|hr_admin|super_admin> [--reason "…"]',
  );
  process.exit(1);
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const { data: employee, error: findError } = await admin
  .from('employees')
  .select('id, full_name, email, role, active')
  .ilike('email', email)
  .maybeSingle();

if (findError) {
  console.error(`Lookup failed: ${findError.message}`);
  process.exit(1);
}
if (!employee) {
  console.error(`No employee with the email ${email}.`);
  process.exit(1);
}

if (employee.role === role) {
  console.log(`${employee.full_name} <${employee.email}> is already ${role}.`);
  process.exit(0);
}

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

const { error: updateError } = await admin
  .from('employees')
  .update({ role })
  .eq('id', employee.id);

if (updateError) {
  console.error(`Update failed: ${updateError.message}`);
  process.exit(1);
}

// The app audits every role change; one made from a terminal should be no
// harder to find than one made from the UI.
const { error: auditError } = await admin.from('audit_log').insert({
  actor_id: null,
  actor_name: 'set-role script',
  actor_email: 'cli',
  action: 'employee.role_change',
  entity_type: 'employee',
  entity_id: employee.id,
  subject_id: employee.id,
  self_action: false,
  detail: { from: employee.role, to: role, via: 'scripts/set-role.mjs', reason },
});

if (auditError) {
  console.error(`(warning) role changed but audit write failed: ${auditError.message}`);
}

await notifyEmployee();

console.log(
  `${employee.full_name} <${employee.email}>: ${employee.role} → ${role}`,
);

async function notifyEmployee() {
  const { error } = await admin.from('notifications').insert({
    recipient_id: employee.id,
    kind: 'role_changed',
    title:
      role === 'hr_admin'
        ? 'You are now an HR administrator'
        : 'Your role changed to employee',
    body: reason ?? 'Changed by a database administrator.',
    entity_type: 'employee',
    entity_id: employee.id,
  });
  if (error) {
    console.error(`(warning) could not notify the employee: ${error.message}`);
  }
}
