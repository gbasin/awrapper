import { test, expect, Page } from '@playwright/test'

async function stubApi(page: Page, busy: boolean) {
  const baseId = 'test-session'
  const now = Date.now()

  await page.route('**/config', async (route) => {
    await route.fulfill({ json: { default_use_worktree: true } })
  })

  // Sessions list and detail
  await page.route('**/sessions', async (route) => {
    if (route.request().method() === 'GET' && route.request().url().endsWith('/sessions')) {
      return route.fulfill({ json: [{ id: baseId, agent_id: 'codex', status: 'running', busy, repo_path: '/fake/repo', branch: null, started_at: now, last_activity_at: now }] })
    }
    return route.continue()
  })

  await page.route(`**/sessions/${baseId}`, async (route) => {
    await route.fulfill({ json: { id: baseId, agent_id: 'codex', status: 'running', busy, repo_path: '/fake/repo', branch: null, started_at: now, last_activity_at: now } })
  })

  await page.route(`**/sessions/${baseId}/messages`, async (route) => {
    await route.fulfill({ json: [] })
  })

  await page.route(`**/sessions/${baseId}/log**`, async (route) => {
    await route.fulfill({ body: '' })
  })

  await page.route('**/client-log', async (route) => {
    await route.fulfill({ status: 204, body: '' })
  })

  return baseId
}

test('status badge shows ready when idle', async ({ page }) => {
  const id = await stubApi(page, false)
  await page.goto(`/s/${id}`)
  await expect(page.locator('[aria-label="ready"]').first()).toBeVisible()
})

test('status badge animates when busy', async ({ page }) => {
  const id = await stubApi(page, true)
  await page.goto(`/s/${id}`)
  // When busy, aria-label remains the underlying status ('running')
  await expect(page.locator('[aria-label="running"]').first()).toBeVisible()
})

