import { execa } from 'execa';
import path from 'node:path';
import fs from 'fs-extra';

export async function isGitRepo(repoPath: string) {
  try {
    await execa('git', ['-C', repoPath, 'rev-parse', '--git-dir']);
    return true;
  } catch {
    return false;
  }
}

export function worktreePath(repoPath: string, sessionId: string) {
  return path.join(repoPath, '.awrapper-worktrees', sessionId);
}

export async function ensureWorktree(repoPath: string, branch: string | undefined, sessionId: string) {
  const wtPath = worktreePath(repoPath, sessionId);
  await fs.ensureDir(path.dirname(wtPath));
  const branchName = branch || 'HEAD';
  try {
    await execa('git', ['-C', repoPath, 'worktree', 'add', wtPath, branchName]);
  } catch (err: any) {
    // If worktree exists, keep it; otherwise, rethrow
    if (!/already exists/i.test(String(err?.stderr || err?.message))) {
      throw err;
    }
  }
  return wtPath;
}

