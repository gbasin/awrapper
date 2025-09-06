import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';

export const APP_NAME = 'awrapper';

export const DATA_DIR = path.join(os.homedir(), `.${APP_NAME}`);
export const DB_PATH = path.join(DATA_DIR, `${APP_NAME}.db`);
export const LOGS_DIR = path.join(DATA_DIR, 'logs');
export const ARTIFACTS_DIR = path.join(DATA_DIR, 'artifacts');

export const DEFAULT_BIND = process.env.BIND_ADDR || '127.0.0.1';
export const DEFAULT_PORT = Number(process.env.PORT || 8787);
export const DEBUG = process.env.AWRAPPER_DEBUG === '1' || process.env.DEBUG === '1';
// Allow explicit log level override; fallback to DEBUG→info else warn
export const LOG_LEVEL = (process.env.AWRAPPER_LOG_LEVEL || 'info') as
  | 'fatal'
  | 'error'
  | 'warn'
  | 'info'
  | 'debug'
  | 'trace';
export const HTTP_LOG = process.env.AWRAPPER_HTTP_LOG === '1';
export const PROTO_TRY_CONFIGURE = process.env.AWRAPPER_PROTO_CONFIGURE === '1';

// Max time to wait for a single user turn to complete in persistent sessions (seconds)
// Defaults to 600 seconds. Can be overridden via env.
export const TURN_TIMEOUT_SECS = Number(
  process.env.AWRAPPER_TURN_TIMEOUT_SECS || process.env.TURN_TIMEOUT_SECS || 600
);

// Comma- or colon-separated list of allowed roots for server-side directory browsing
// Defaults to the user's home directory.
const RAW_ROOTS = (process.env.AWRAPPER_BROWSE_ROOTS || process.env.BROWSE_ROOTS || '~')
  .split(/[,:]/)
  .map((s) => s.trim())
  .filter(Boolean);

function expandHome(p: string) {
  if (!p) return p;
  if (p === '~' || p.startsWith('~/')) return path.join(os.homedir(), p.slice(1));
  return p;
}

export const BROWSE_ROOTS = RAW_ROOTS.length > 0 ? RAW_ROOTS.map((p) => path.resolve(expandHome(p))) : [os.homedir()];

export async function ensureDataDirs() {
  await fs.ensureDir(DATA_DIR);
  await fs.ensureDir(LOGS_DIR);
  await fs.ensureDir(ARTIFACTS_DIR);
}
