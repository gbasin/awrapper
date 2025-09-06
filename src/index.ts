async function main() {
  // Enforce Node.js 22 or 23 before importing native deps
  const major = Number(process.versions.node.split('.')[0] || '0');
  if (!(major === 22 || major === 23)) {
    console.error(`This project requires Node.js 22 or 23. Current: ${process.version}`);
    console.error('Use `nvm use` (from .nvmrc) or switch your default Node to 22.x.');
    process.exit(1);
  }

  const { ensureDataDirs } = await import('./config.js');
  const { ensureAgentsRegistry } = await import('./agents.js');
  const { getDb } = await import('./db.js');
  const { buildServer } = await import('./server.js');

  await ensureDataDirs();
  getDb();
  ensureAgentsRegistry();
  await buildServer();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
