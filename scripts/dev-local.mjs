// One-command local dev without Docker: embedded Postgres + schema push + all apps.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
const isWin = process.platform === 'win32';

// 1. Ensure .env exists with a generated SESSION_SECRET and dev defaults
if (!existsSync(envPath)) writeFileSync(envPath, readFileSync(resolve(root, '.env.example'), 'utf8'));
let env = readFileSync(envPath, 'utf8');
const setIfEmpty = (key, value) => {
  const re = new RegExp(`^${key}=.*$`, 'm');
  const m = env.match(re);
  if (!m) env += `\n${key}=${value}`;
  else if (m[0].trim() === `${key}=`) env = env.replace(re, `${key}=${value}`);
};
setIfEmpty('SESSION_SECRET', randomBytes(32).toString('hex'));
setIfEmpty('GITHUB_CLIENT_ID', 'dev-placeholder');
setIfEmpty('GITHUB_CLIENT_SECRET', 'dev-placeholder');
setIfEmpty('DEV_LOGIN', 'true'); // dev-only login button (ignored in production)
writeFileSync(envPath, env);

// Load .env into this process so child processes (prisma, turbo) inherit it
for (const raw of env.split(String.fromCharCode(10))) {
  const m = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

// 1b. Free this project's dev ports from leftover processes of a previous run (Windows)
if (isWin) {
  spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      'Get-NetTCPConnection -LocalPort 4000,4001,5173,5432 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Get-CimInstance Win32_Process -Filter "Name=\'postgres.exe\'" | Where-Object { $_.CommandLine -like "*embedded-postgres*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep 3',
    ],
    { stdio: 'ignore' },
  );
}
try {
  rmSync(resolve(root, '.local/postgres/postmaster.pid'), { force: true });
} catch {
  /* ignore */
}

// 2. Embedded Postgres (data persisted in .local/postgres)
const dir = resolve(root, '.local/postgres');
mkdirSync(resolve(root, '.local'), { recursive: true });
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: 'gitcity',
  password: 'gitcity',
  port: 5432,
  persistent: true,
});
if (!existsSync(resolve(dir, 'PG_VERSION'))) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase('gitcity');
} catch {
  /* already exists */
}
console.log('[dev-local] Postgres ready on :5432');

// 3. Apply the Prisma schema
const run = (args) => spawnSync('pnpm', args, { cwd: root, stdio: 'inherit', shell: isWin });
if (run(['--filter', '@gitcity/database', 'run', 'push']).status !== 0) {
  await pg.stop();
  process.exit(1);
}

// 4. Start all apps
const apps = spawn('pnpm', ['exec', 'turbo', 'run', 'dev', '--parallel'], {
  cwd: root,
  stdio: 'inherit',
  shell: isWin,
});
const shutdown = async () => {
  apps.kill();
  await pg.stop().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
apps.on('exit', shutdown);
