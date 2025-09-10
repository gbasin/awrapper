export type Session = {
  id: string
  agent_id: string
  status: string
  busy?: boolean
  pending_approval?: boolean
  repo_path: string
  branch: string | null
  started_at: number
  last_activity_at: number | null
  block_while_running?: boolean | 0 | 1
}

export type Message = {
  id: string
  session_id: string
  turn_id: string | null
  role: 'user' | 'assistant'
  content: string
  created_at: number
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...(init || {}), headers: { ...(init?.headers || {}), Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export const api = {
  listSessions: () => json<Session[]>('/sessions'),
  getSession: (id: string) => json<Session>(`/sessions/${id}`),
  getConfig: () => json<{ default_use_worktree: boolean; enable_commit?: boolean; enable_promote?: boolean }>('/config'),
  createSession: async (body: { repo_path: string; branch?: string; initial_message?: string; use_worktree?: boolean; block_while_running?: boolean }) => {
    const res = await fetch('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(await res.text())
    try {
      return (await res.json()) as { id: string }
    } catch {
      // If server responds with redirect to /sessions/:id, extract id
      const loc = res.headers.get('location') || ''
      const id = loc.split('/').pop() || ''
      return { id }
    }
  },
  listMessages: (id: string) => json<Message[]>(`/sessions/${id}/messages`),
  sendMessage: (id: string, content: string) => json(`/sessions/${id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }),
  updateSession: (id: string, body: Partial<Pick<Session, 'block_while_running'>>) => json<Session>(`/sessions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  sendApproval: (id: string, body: { call_id: string; decision: 'approve' | 'deny'; scope?: 'once' | 'session' | 'path'; path?: string; reason?: string }) =>
    json(`/sessions/${id}/approvals`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }),
  tailLog: async (id: string, tail: number | 'all' = 800) => {
    const param = typeof tail === 'number' ? String(tail) : 'all'
    const res = await fetch(`/sessions/${id}/log?tail=${param}`, { cache: 'no-store', headers: { 'Accept': 'text/plain' } })
    return res.ok ? res.text() : ''
  },
  // Changes Review API
  getChanges: (id: string) => json<{ gitAvailable?: boolean; head: string | null; staged: Array<{ path: string; status: string; renamed_from?: string }>; unstaged: Array<{ path: string; status: string; renamed_from?: string }> }>(`/sessions/${id}/changes`),
  getDiff: (id: string, path: string, side: 'worktree' | 'index' | 'head' = 'worktree', context = 3) =>
    json<{ isBinary: boolean; diff?: string; size?: number; sha?: string }>(`/sessions/${id}/diff?${new URLSearchParams({ path, side, context: String(context) }).toString()}`),
  getFile: (id: string, path: string, rev: 'head' | 'index' | 'worktree' = 'worktree') =>
    json<{ content: string; etag: string }>(`/sessions/${id}/file?${new URLSearchParams({ path, rev }).toString()}`),
  putFile: (id: string, body: { path: string; content: string; stage?: boolean; expected_etag?: string }) =>
    json<{ ok: true }>(`/sessions/${id}/file`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  postGit: (
    id: string,
    body:
      | { op: 'stage'; paths: string[] }
      | { op: 'unstage'; paths: string[] }
      | { op: 'discardWorktree'; paths: string[] }
      | { op: 'discardIndex'; paths: string[] }
      | { op: 'commit'; message: string }
  ) => json<{ ok: true }>(`/sessions/${id}/git`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  // Promote API (Phase 4)
  getPromotePreflight: (id: string) =>
    json<{ enable_promote?: boolean; gitAvailable?: boolean; ghAvailable?: boolean; remote?: string | null; remoteUrl?: string | null; defaultBranch?: string | null; currentBranch?: string | null; onDefaultBranch?: boolean; ahead?: number; behind?: number; stagedCount?: number; unstagedCount?: number; uncommitted?: boolean }>(`/sessions/${id}/promote/preflight`),
  postPromote: (id: string, body: { message: string; branch?: string }) =>
    json<{ ok: true; branch: string; pushed: boolean; prUrl?: string; compareUrl?: string }>(`/sessions/${id}/promote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
}
