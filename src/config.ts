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

export async function ensureDataDirs() {
  await fs.ensureDir(DATA_DIR);
  await fs.ensureDir(LOGS_DIR);
  await fs.ensureDir(ARTIFACTS_DIR);
}

