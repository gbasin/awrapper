import { test, expect, Page } from '@playwright/test'

async function stubApi(page: Page) {
  const id = 'sess-proposed'
  const now = Date.now()

  await page.route('**/config', async (route) => {
    await route.fulfill({ json: { default_use_worktree: true } })
  })

  await page.route('**/sessions', async (route) => {
    if (route.request().method() === 'GET' && route.request().url().endsWith('/sessions')) {
      return route.fulfill({ json: [{ id, agent_id: 'codex', status: 'running', repo_path: '/fake/repo', branch: null, started_at: now, last_activity_at: now }] })
    }
    return route.continue()
  })

  await page.route(`**/sessions/${id}`, async (route) => {
    await route.fulfill({ json: { id, agent_id: 'codex', status: 'running', repo_path: '/fake/repo', branch: null, started_at: now, last_activity_at: now } })
  })

  await page.route(`**/sessions/${id}/messages`, async (route) => {
    await route.fulfill({ json: [] })
  })

  // Log: provide two runs with approvals; run-new is latest
  await page.route(`**/sessions/${id}/log**`, async (route) => {
    const lines = [
      JSON.stringify({ id: 'run-old', ts: 1000, msg: { type: 'task_started' } }),
      JSON.stringify({ id: 'run-old', ts: 1001, msg: { type: 'apply_patch_approval_request', call_id: 'c1', changes: { 'a.txt': { add: true } } } }),
      JSON.stringify({ id: 'run-old', ts: 1002, msg: { type: 'task_complete' } }),
      JSON.stringify({ id: 'run-new', ts: 2000, msg: { type: 'task_started' } }),
      JSON.stringify({ id: 'run-new', ts: 2001, msg: { type: 'apply_patch_approval_request', call_id: 'c2', changes: { 'b.txt': { mod: true } } } }),
      JSON.stringify({ id: 'run-new', ts: 2002, msg: { type: 'task_complete' } }),
    ].join('\n')
    await route.fulfill({ body: lines, headers: { 'content-type': 'text/plain' } })
  })

  await page.route('**/client-log', async (route) => { await route.fulfill({ status: 204, body: '' }) })

  await page.route(`**/sessions/${id}/changes`, async (route) => {
    await route.fulfill({ json: { gitAvailable: true, head: 'HEAD', staged: [], unstaged: [] } })
  })

  return { id }
}

test('Proposed list filters by latest run with toggle', async ({ page }) => {
  const { id } = await stubApi(page)
  await page.goto(`/s/${id}`)

  // Proposed shows two requests initially
  await expect(page.getByText('Proposed')).toBeVisible()
  await expect(page.getByText('Request c1', { exact: false })).toBeVisible()
  await expect(page.getByText('Request c2', { exact: false })).toBeVisible()

  // Toggle Only new since this turn
  const toggle = page.getByLabel('Only new since this turn')
  await toggle.check()

  // Only the latest run (c2) remains visible
  await expect(page.getByText('Request c1', { exact: false })).toHaveCount(0)
  await expect(page.getByText('Request c2', { exact: false })).toBeVisible()
})

