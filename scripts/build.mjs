import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
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
Object.assign(process.env, env);

const require = createRequire(import.meta.url);
let vite;
try {
  vite = require('vite');
} catch (error) {
  console.error('Failed to resolve Vite package:', error);
  process.exit(1);
}

try {
  await vite.build({
    mode: 'production',
    configFile: path.join(projectRoot, 'vite.config.ts'),
  });
} catch (error) {
  console.error('Failed to run Vite build:', error);
  process.exit(1);
}
