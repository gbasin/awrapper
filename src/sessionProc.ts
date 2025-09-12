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
  worktree,
  options,
}: {
  worktree: string;
  options?: {
    model?: string;
    approval_policy?: 'untrusted' | 'on-failure' | 'on-request' | 'never';
    sandbox_mode?: 'read-only' | 'workspace-write' | 'danger-full-access';
    include_plan_tool?: boolean;
    web_search?: boolean;
    include_apply_patch_tool?: boolean;
    include_view_image_tool?: boolean;
  };
}): Promise<SpawnResult> {
  const id = path.basename(worktree);
  const { logPath, artifactDir } = await setupPaths(id);

  // NOTE: Protocol specifics TBD; we currently just start the process and pipe logs.
  const codexBin = process.env.CODEX_BIN || 'codex';
  // Build proto spawn args using -c overrides only.
  const args: string[] = [];
  const add = (k: string, v: string | boolean | undefined) => {
    if (v === undefined) return;
    const val = typeof v === 'boolean' ? String(v) : v;
    args.push('-c');
    args.push(`${k}=${/\s|"/.test(String(val)) ? JSON.stringify(val) : String(val)}`);
  };
  add('model', options?.model);
  add('approval_policy', options?.approval_policy);
  add('sandbox_mode', options?.sandbox_mode);
  add('include_plan_tool', options?.include_plan_tool ?? true);
  add('include_apply_patch_tool', options?.include_apply_patch_tool ?? true);
  add('include_view_image_tool', options?.include_view_image_tool ?? true);
  add('tools.web_search', options?.web_search ?? true);
  args.push('proto');
  const proc = execa(codexBin, args, { all: true, cwd: worktree });
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  proc.all?.pipe(logStream);
  return { proc, logPath, artifactDir };
}
