import { spawn } from 'node:child_process';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');

const env = { ...process.env };

if (!env.VITE_BACKEND_URL || env.VITE_BACKEND_URL.trim() === '') {
  env.VITE_BACKEND_URL = 'self';
}

if (!env.FRONTEND_ORIGIN || env.FRONTEND_ORIGIN.trim() === '') {
  env.FRONTEND_ORIGIN = 'http://localhost:5173';
}

const viteBinary = path.join(projectRoot, 'node_modules', '.bin', 'vite');
const isWindows = process.platform === 'win32';
const executable = isWindows ? `${viteBinary}.cmd` : viteBinary;

const child = spawn(executable, ['build'], {
  cwd: projectRoot,
  env,
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`vite build terminated with signal ${signal}`);
    process.exit(1);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('Failed to start vite build:', error);
  process.exit(1);
});
