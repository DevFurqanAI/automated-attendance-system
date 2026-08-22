/**
 * Applies the SQL files in supabase/ to the Supabase project.
 *
 * A substitute for the dashboard SQL editor. Supports two credentials, either
 * of which is enough — pick whichever you can get to:
 *
 *   1. SUPABASE_ACCESS_TOKEN — a personal access token from
 *      https://supabase.com/dashboard/account/tokens
 *      Runs the SQL through the Management API. No database password, no
 *      network/IPv6 considerations. Preferred.
 *
 *   2. SUPABASE_DB_URL — the full Postgres connection string from
 *      Dashboard → Connect → ORMs / psql. Connects directly with `pg`.
 *
 * Usage:
 *   node scripts/db-apply.mjs                 # migrations + seed
 *   node scripts/db-apply.mjs --no-seed       # migrations only
 *   node scripts/db-apply.mjs --file <path>   # one specific file
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function loadEnvLocal() {
  const file = path.join(ROOT, '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const i = trimmed.indexOf('=');
    const key = trimmed.slice(0, i).trim();
    const value = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const args = process.argv.slice(2);
const noSeed = args.includes('--no-seed');
const fileArgIndex = args.indexOf('--file');
const singleFile = fileArgIndex !== -1 ? args[fileArgIndex + 1] : null;

const projectRef = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').match(
  /https:\/\/([a-z0-9]+)\.supabase\.co/,
)?.[1];

function collectFiles() {
  if (singleFile) return [path.resolve(ROOT, singleFile)];

  const migrationsDir = path.join(ROOT, 'supabase', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(migrationsDir, f));

  const seed = path.join(ROOT, 'supabase', 'seed.sql');
  if (!noSeed && fs.existsSync(seed)) files.push(seed);

  return files;
}

/** Runs SQL via the Supabase Management API. */
async function runViaManagementApi(sql, label) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${label}: HTTP ${response.status} — ${body}`);
  }
  return response.json().catch(() => null);
}

/** Runs SQL over a direct Postgres connection. */
async function runViaPostgres(files) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(file, 'utf8');
      process.stdout.write(`  applying ${path.basename(file)} … `);
      await client.query(sql);
      console.log('ok');
    }
  } finally {
    await client.end();
  }
}

async function main() {
  if (!projectRef) {
    throw new Error(
      'Could not read the project ref from NEXT_PUBLIC_SUPABASE_URL in .env.local.',
    );
  }

  const files = collectFiles();
  console.log(`project: ${projectRef}`);
  console.log(`files:   ${files.length}`);

  const hasPat = Boolean(process.env.SUPABASE_ACCESS_TOKEN);
  const hasDbUrl = Boolean(process.env.SUPABASE_DB_URL);

  if (!hasPat && !hasDbUrl) {
    console.error(
      '\nNo credential found. Set ONE of these and re-run:\n\n' +
        '  SUPABASE_ACCESS_TOKEN  — personal access token\n' +
        '      https://supabase.com/dashboard/account/tokens\n\n' +
        '  SUPABASE_DB_URL        — Postgres connection string\n' +
        '      Dashboard → Connect → psql\n',
    );
    process.exit(1);
  }

  if (hasPat) {
    console.log('method:  Management API\n');
    for (const file of files) {
      const sql = fs.readFileSync(file, 'utf8');
      process.stdout.write(`  applying ${path.basename(file)} … `);
      await runViaManagementApi(sql, path.basename(file));
      console.log('ok');
    }
  } else {
    console.log('method:  direct Postgres\n');
    await runViaPostgres(files);
  }

  console.log('\nAll SQL applied.');
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
