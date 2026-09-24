import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const electronPath = require('electron');
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
const vite = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
  { stdio: 'inherit' },
);
children.push(vite);
vite.on('error', (error) => {
  console.error(error.message);
  stop(1);
});
vite.on('exit', (code) => {
  if (!stopping) stop(code || 1);
});
let ready = false;
for (let attempt = 0; attempt < 100 && !stopping; attempt++) {
  try {
    const response = await fetch('http://127.0.0.1:5173');
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    /* Vite is starting. */
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
}
if (!stopping && ready) {
  const child = spawn(electronPath, ['.', '--dev'], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code) => stop(code || 0));
} else if (!stopping) {
  console.error('Vite 5173 portunda açıla bilmədi.');
  stop(1);
}
