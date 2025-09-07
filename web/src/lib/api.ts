export type Session = {
  id: string
  agent_id: string
  status: string
  repo_path: string
  branch: string | null
  started_at: number
  last_activity_at: number | null
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
  getConfig: () => json<{ default_use_worktree: boolean }>('/config'),
  createSession: async (body: { repo_path: string; branch?: string; initial_message?: string; use_worktree?: boolean }) => {
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
  sendApproval: (id: string, body: { call_id: string; decision: 'approve' | 'deny'; scope?: 'once' | 'session' | 'path'; path?: string; reason?: string }) =>
    json(`/sessions/${id}/approvals`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }),
  tailLog: async (id: string, tail: number | 'all' = 800) => {
    const param = typeof tail === 'number' ? String(tail) : 'all'
    const res = await fetch(`/sessions/${id}/log?tail=${param}`)
    return res.ok ? res.text() : ''
  },
}
