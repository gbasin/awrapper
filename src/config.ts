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
// Feature flag: enable commit API/UI in Changes panel
export const ENABLE_GIT_COMMIT =
  process.env.AWRAPPER_ENABLE_COMMIT === '1' || process.env.AWRAPPER_GIT_COMMIT === '1';

// Feature flag: enable Promote (push + PR) flow in Changes panel
// When enabled, server exposes preflight and promote endpoints and UI shows Promote dialog.
export const ENABLE_PROMOTE =
  process.env.AWRAPPER_ENABLE_PROMOTE === '1' || process.env.AWRAPPER_GIT_PROMOTE === '1' || false;

// Default behavior for using Git worktrees when creating sessions.
// Set AWRAPPER_USE_WORKTREE=0 or =false to disable by default.
const RAW_USE_WT = process.env.AWRAPPER_USE_WORKTREE ?? '1';
export const DEFAULT_USE_WORKTREE = RAW_USE_WT !== '0' && RAW_USE_WT.toLowerCase() !== 'false';

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

// Session defaults (can be overridden per-session via POST /sessions)
function parseBoolEnv(v: string | undefined, fallback: boolean) {
  if (v == null) return fallback;
  const s = String(v).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  return fallback;
}

export const DEFAULT_MODEL = process.env.AWRAPPER_MODEL_DEFAULT || 'gpt-5-high';
export const DEFAULT_APPROVAL_POLICY = (process.env.AWRAPPER_APPROVAL_POLICY_DEFAULT || 'never') as
  | 'untrusted'
  | 'on-failure'
  | 'on-request'
  | 'never';
export const DEFAULT_SANDBOX_MODE = (process.env.AWRAPPER_SANDBOX_MODE_DEFAULT || 'workspace-write') as
  | 'read-only'
  | 'workspace-write'
  | 'danger-full-access';
export const DEFAULT_INCLUDE_PLAN_TOOL = parseBoolEnv(process.env.AWRAPPER_INCLUDE_PLAN_DEFAULT, true);
export const DEFAULT_WEB_SEARCH = parseBoolEnv(process.env.AWRAPPER_WEB_SEARCH_DEFAULT, true);
// Always keep these tools on by default; expose overrides later if needed
export const DEFAULT_INCLUDE_APPLY_PATCH_TOOL = parseBoolEnv(process.env.AWRAPPER_INCLUDE_APPLY_PATCH_DEFAULT, true);
export const DEFAULT_INCLUDE_VIEW_IMAGE_TOOL = parseBoolEnv(process.env.AWRAPPER_INCLUDE_VIEW_IMAGE_DEFAULT, true);
