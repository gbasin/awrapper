import { execa, type Subprocess } from 'execa';
import fs from 'fs-extra';
import path from 'node:path';
import { ARTIFACTS_DIR, LOGS_DIR } from './config.js';

export type SpawnResult = {
  proc: Subprocess | null;
  logPath: string;
  artifactDir: string;
};

export async function setupPaths(id: string) {
  const logPath = path.join(LOGS_DIR, `session-${id}.log`);
  const artifactDir = path.join(ARTIFACTS_DIR, `session-${id}`);
  await fs.ensureDir(path.dirname(logPath));
  await fs.ensureDir(artifactDir);
  return { logPath, artifactDir };
}

export async function spawnOneshotCodex({
  worktree,
  prompt
}: {
  worktree: string;
  prompt: string;
}): Promise<SpawnResult> {
  const id = path.basename(worktree);
  const { logPath, artifactDir } = await setupPaths(id);
  const lastMsgPath = path.join(artifactDir, 'last-message.txt');

  const codexBin = process.env.CODEX_BIN || 'codex';
  const args = ['exec', '--json', '-C', worktree, '--output-last-message', lastMsgPath, prompt];
  const proc = execa(codexBin, args, { all: true });

  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  proc.all?.pipe(logStream);

  // Let caller await proc if desired
  return { proc, logPath, artifactDir };
}

export async function spawnPersistentCodex({
  worktree
}: {
  worktree: string;
}): Promise<SpawnResult> {
  const id = path.basename(worktree);
  const { logPath, artifactDir } = await setupPaths(id);

  // NOTE: Protocol specifics TBD; we currently just start the process and pipe logs.
  const codexBin = process.env.CODEX_BIN || 'codex';
  const args = ['-a=never', 'proto', '-C', worktree];
  const proc = execa(codexBin, args, { all: true });
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  proc.all?.pipe(logStream);
  return { proc, logPath, artifactDir };
}
