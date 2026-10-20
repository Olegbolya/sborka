#!/usr/bin/env node
// Development runner for compiled Node apps (api, worker): `tsc --watch` + `node --watch` on the output.
// Usage (from an app folder): node ../../scripts/dev-node.mjs dist/main.js
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const entry = process.argv[2] ?? 'dist/main.js';
const children = [];
const run = (cmd, args) => {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  children.push(child);
  child.on('exit', (code) => {
    if (code && code !== 0) process.exitCode = code;
  });
  return child;
};

const tsc = run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput']);
const waitForBuild = setInterval(() => {
  if (!existsSync(entry)) return;
  clearInterval(waitForBuild);
  run(process.execPath, ['--enable-source-maps', '--watch-path=dist', entry]);
}, 500);

const stop = () => {
  clearInterval(waitForBuild);
  for (const c of children) c.kill('SIGTERM');
  tsc.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
