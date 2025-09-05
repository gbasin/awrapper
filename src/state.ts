import type { Subprocess } from 'execa';
import type { CodexProtoSession } from './proto.js';

// In-memory process + locks per session
export const procs = new Map<string, Subprocess>();
export const locks = new Map<string, boolean>();
export const protoSessions = new Map<string, CodexProtoSession>();

export function acquireLock(sessionId: string) {
  if (locks.get(sessionId)) return false;
  locks.set(sessionId, true);
  return true;
}

export function releaseLock(sessionId: string) {
  locks.delete(sessionId);
}
