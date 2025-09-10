import type { Subprocess } from 'execa';
import type { CodexProtoSession } from './proto.js';

// In-memory process + locks per session
export const procs = new Map<string, Subprocess>();
export const locks = new Map<string, boolean>();
export const protoSessions = new Map<string, CodexProtoSession>();
// Tracks runs awaiting user approval per session (session_id -> Set<run_id>)
export const sessionApprovalWaits = new Map<string, Set<string>>();

export function acquireLock(sessionId: string) {
  if (locks.get(sessionId)) return false;
  locks.set(sessionId, true);
  return true;
}

export function releaseLock(sessionId: string) {
  locks.delete(sessionId);
}
