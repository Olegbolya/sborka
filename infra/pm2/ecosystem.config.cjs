// PM2-процессы Блоккера. Запускаются только через infra/deploy.sh (`--only blokum-*`), поэтому
// процессы BST в том же PM2 не затрагиваются. Секреты — из shared/.env.prod через `node --env-file`.
const ROOT = process.env.BLOKUM_ROOT || '/home/deploy/blokum';
const CURRENT = `${ROOT}/current`;
const NODE = process.env.BLOKUM_NODE || 'node';
const ENV_FILE = `${ROOT}/shared/.env.prod`;
const LOGS = process.env.BLOKUM_LOGS || `${process.env.HOME || '/home/deploy'}/logs`;
const APP_VERSION = process.env.APP_VERSION || 'unknown';

// The settings file always wins: `node --env-file` does not override a variable the process already has, and PM2 keeps the
// environment a process was first started with — an old key stayed in the running API after .env.prod had a new one (ADR-124).
const fileEnv = (() => {
  try {
    const out = {};
    for (const line of require('node:fs').readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
    return out;
  } catch {
    return {};
  }
})();

const common = {
  interpreter: NODE,
  node_args: [`--env-file=${ENV_FILE}`, '--enable-source-maps'],
  exec_mode: 'fork',
  instances: 1,
  autorestart: true,
  max_restarts: 10,
  min_uptime: '10s',
  kill_timeout: 10000,
  merge_logs: true,
  time: true,
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'blokum-api',
      cwd: `${CURRENT}/apps/api`,
      script: 'dist/main.js',
      max_memory_restart: '500M',
      env: { ...fileEnv, NODE_ENV: 'production', APP_VERSION },
      out_file: `${LOGS}/blokum-api-out.log`,
      error_file: `${LOGS}/blokum-api-error.log`,
    },
    {
      ...common,
      name: 'blokum-web',
      cwd: `${CURRENT}/apps/web`,
      script: 'node_modules/next/dist/bin/next',
      args: `start --port ${process.env.WEB_PORT || 3110} --hostname 127.0.0.1`,
      max_memory_restart: '700M',
      env: { ...fileEnv, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', APP_VERSION },
      out_file: `${LOGS}/blokum-web-out.log`,
      error_file: `${LOGS}/blokum-web-error.log`,
    },
    {
      ...common,
      name: 'blokum-worker',
      cwd: `${CURRENT}/apps/worker`,
      script: 'dist/main.js',
      max_memory_restart: '700M',
      env: { ...fileEnv, NODE_ENV: 'production', APP_VERSION },
      out_file: `${LOGS}/blokum-worker-out.log`,
      error_file: `${LOGS}/blokum-worker-error.log`,
    },
  ],
};
