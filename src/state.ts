import type { ExecaChildProcess } from 'execa';

// In-memory process + locks per session
export const procs = new Map<string, ExecaChildProcess>();
export const locks = new Map<string, boolean>();

export function acquireLock(sessionId: string) {
  if (locks.get(sessionId)) return false;
  locks.set(sessionId, true);
  return true;
}

export function releaseLock(sessionId: string) {
  locks.delete(sessionId);
}

