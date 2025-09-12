import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Button } from '../components/ui/button'
import { BrowseDialog } from './BrowseDialog'
import { toast } from 'sonner'
import { Switch } from '../components/ui/switch'
import { Select } from '../components/ui/select'

export default function NewSession() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const [repo, setRepo] = useState<string>(() => {
    try { return localStorage.getItem('awrapper:lastRepoPath') || '' } catch { return '' }
  })
  const [branch, setBranch] = useState<string>(() => {
    try { return localStorage.getItem('awrapper:lastBranch') || '' } catch { return '' }
  })
  const [initial, setInitial] = useState('')
  const [useWorktree, setUseWorktree] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('awrapper:useWorktree')
      return raw == null ? true : JSON.parse(raw)
    } catch { return true }
  })
  const [blockWhileRunning, setBlockWhileRunning] = useState<boolean>(true)
  // Session settings
  const [model, setModel] = useState<string>('')
  const [approvalPolicy, setApprovalPolicy] = useState<'never' | 'on-request' | 'on-failure' | 'untrusted'>('never')
  const [sandboxMode, setSandboxMode] = useState<'read-only' | 'workspace-write' | 'danger-full-access'>('workspace-write')
  const [includePlanTool, setIncludePlanTool] = useState<boolean>(true)
  const [webSearch, setWebSearch] = useState<boolean>(true)
  const [includeApplyPatchTool, setIncludeApplyPatchTool] = useState<boolean>(true)
  const [includeViewImageTool, setIncludeViewImageTool] = useState<boolean>(true)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('awrapper:useWorktree')
      if (raw == null) {
        api.getConfig().then((c) => {
          setUseWorktree(!!c.default_use_worktree)
          if (c.model_default) setModel(c.model_default)
          if (c.approval_policy_default && ['never','on-request','on-failure','untrusted'].includes(c.approval_policy_default)) setApprovalPolicy(c.approval_policy_default as any)
          if (c.sandbox_mode_default && ['read-only','workspace-write','danger-full-access'].includes(c.sandbox_mode_default)) setSandboxMode(c.sandbox_mode_default as any)
          if (typeof c.include_plan_tool_default === 'boolean') setIncludePlanTool(c.include_plan_tool_default)
          if (typeof c.web_search_default === 'boolean') setWebSearch(c.web_search_default)
          if (typeof c.include_apply_patch_tool_default === 'boolean') setIncludeApplyPatchTool(c.include_apply_patch_tool_default)
          if (typeof c.include_view_image_tool_default === 'boolean') setIncludeViewImageTool(c.include_view_image_tool_default)
        }).catch(() => {})
      }
    } catch {}
  }, [])

  useEffect(() => { try { localStorage.setItem('awrapper:lastRepoPath', repo) } catch {} }, [repo])
  useEffect(() => { try { localStorage.setItem('awrapper:lastBranch', branch) } catch {} }, [branch])

  const m = useMutation({
    mutationFn: api.createSession,
    onSuccess: async ({ id }) => {
      toast.success('Session created')
      await qc.invalidateQueries({ queryKey: ['sessions'] })
      if (id) nav(`/s/${id}`)
    },
    onError: (e: any) => toast.error(e.message || 'Failed to create session'),
  })

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Card className="flex-1 min-h-0">
        <CardHeader>
          <CardTitle>Start a new session</CardTitle>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 md:grid-cols-3">
            <div className="flex items-center gap-2 sm:col-span-2 md:col-span-3">
              <Input
                required
                placeholder="/path/to/repo"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
              />
              <BrowseDialog onSelect={(p) => setRepo(p)} />
            </div>
            <Input
              placeholder="branch (optional)"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="sm:col-span-2 md:col-span-3"
            />
            <div className="flex items-center gap-2 sm:col-span-2 md:col-span-3">
              <Switch
                checked={useWorktree}
                onCheckedChange={(v) => {
                  setUseWorktree(v)
                  try { localStorage.setItem('awrapper:useWorktree', JSON.stringify(v)) } catch {}
                }}
              />
              <span title="When off, the agent runs directly in your repo. Not isolated; may modify your working tree. If you set a branch, it must match the current checkout.">Use Git worktree (recommended)</span>
            </div>
            <div className="flex items-center gap-2 sm:col-span-2 md:col-span-3">
              <Switch checked={blockWhileRunning} onCheckedChange={setBlockWhileRunning} />
              <span title="When on, the UI disables Send while a turn is running.">Block while running</span>
            </div>
            <Input
              placeholder="model (e.g., gpt-5-high)"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="sm:col-span-2 md:col-span-3"
            />
            <div className="flex items-center gap-2">
              <span className="text-sm w-28">Approval</span>
              <Select
                className="w-[220px]"
                value={approvalPolicy}
                onChange={(e) => setApprovalPolicy(e.target.value as any)}
              >
                <option value="never">never</option>
                <option value="on-request">on-request</option>
                <option value="on-failure">on-failure</option>
                <option value="untrusted">untrusted</option>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm w-28">Sandbox</span>
              <Select
                className="w-[220px]"
                value={sandboxMode}
                onChange={(e) => setSandboxMode(e.target.value as any)}
              >
                <option value="read-only">read-only</option>
                <option value="workspace-write">workspace-write</option>
                <option value="danger-full-access">danger-full-access</option>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={includePlanTool} onCheckedChange={setIncludePlanTool} />
              <span>Plan tool</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={webSearch} onCheckedChange={setWebSearch} />
              <span>Web search</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={includeApplyPatchTool} onCheckedChange={setIncludeApplyPatchTool} />
              <span>Apply patch tool</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={includeViewImageTool} onCheckedChange={setIncludeViewImageTool} />
              <span>View image tool</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col min-h-0">
          <div className="mt-2 flex-1 min-h-0">
            <div className="rounded border h-full flex flex-col">
              <div className="flex-1 p-2 bg-slate-50">
                <div className="space-y-2">
                  <Textarea
                    rows={10}
                    value={initial}
                    onChange={(e) => setInitial(e.target.value)}
                    placeholder="Draft your initial message…"
                  />
                </div>
              </div>
              <form
                className="flex gap-2 border-t p-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!repo.trim()) return
                  m.mutate({
                    repo_path: repo,
                    branch: branch || undefined,
                    initial_message: initial || undefined,
                    use_worktree: useWorktree,
                    block_while_running: blockWhileRunning,
                    model: model || undefined,
                    approval_policy: approvalPolicy,
                    sandbox_mode: sandboxMode,
                    include_plan_tool: includePlanTool,
                    web_search: webSearch,
                    include_apply_patch_tool: includeApplyPatchTool,
                    include_view_image_tool: includeViewImageTool,
                  })
                }}
              >
                <Button type="submit" disabled={m.isPending}>{m.isPending ? 'Creating…' : 'Create session'}</Button>
              </form>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
