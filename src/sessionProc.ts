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

export async function spawnPersistentCodex({
  worktree
}: {
  worktree: string;
}): Promise<SpawnResult> {
  const id = path.basename(worktree);
  const { logPath, artifactDir } = await setupPaths(id);

  // NOTE: Protocol specifics TBD; we currently just start the process and pipe logs.
  const codexBin = process.env.CODEX_BIN || 'codex';
  // Spawn proto with config overrides to enable plan tool and align policies.
  // Note: proto subcommand only respects -c overrides (not -a/--sandbox flags).
  const args = [
    // Enable the plan tool so the agent can call update_plan in persistent sessions
    '-c', 'include_plan_tool=true',
    // Prefer never approvals; awrapper handles approvals externally
    '-c', 'approval_policy="never"',
    // Allow workspace writes by default so apply_patch and edits work
    '-c', 'sandbox_mode="workspace-write"',
    'proto'
  ];
  const proc = execa(codexBin, args, { all: true, cwd: worktree });
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  proc.all?.pipe(logStream);
  return { proc, logPath, artifactDir };
}
