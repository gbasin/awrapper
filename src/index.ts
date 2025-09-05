import { ensureDataDirs } from './config.js';
import { ensureAgentsRegistry } from './agents.js';
import { getDb } from './db.js';
import { buildServer } from './server.js';

async function main() {
  await ensureDataDirs();
  getDb();
  ensureAgentsRegistry();
  await buildServer();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

