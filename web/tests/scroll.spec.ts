import { test, expect, Page } from '@playwright/test'

// Simple stubs for API endpoints used by the Session route
async function stubApi(page: Page) {
  const baseId = 'test-session'
  const now = Date.now()

  await page.route('**/config', async (route) => {
    await route.fulfill({ json: { default_use_worktree: true } })
  })

  await page.route('**/sessions', async (route) => {
    // List
    if (route.request().method() === 'GET' && route.request().url().endsWith('/sessions')) {
      return route.fulfill({ json: [{ id: baseId, agent_id: 'codex', status: 'running', repo_path: '/fake/repo', branch: null, started_at: now, last_activity_at: now }] })
    }
    return route.continue()
  })

  await page.route(`**/sessions/${baseId}`, async (route) => {
    await route.fulfill({ json: { id: baseId, agent_id: 'codex', status: 'running', repo_path: '/fake/repo', branch: null, started_at: now, last_activity_at: now } })
  })

  await page.route(`**/sessions/${baseId}/messages`, async (route) => {
    const mkMsg = (i: number, role: 'user' | 'assistant') => ({
      id: `m-${i}`,
      session_id: baseId,
      turn_id: role === 'assistant' ? `t-${i}` : null,
      role,
      content: `${role} message ${i}\n` + 'x'.repeat(200),
      created_at: now + i * 1000,
    })
    const arr: any[] = []
    for (let i = 0; i < 60; i++) arr.push(mkMsg(i * 2 + 1, 'user'), mkMsg(i * 2 + 2, 'assistant'))
    await route.fulfill({ json: arr })
  })

  await page.route(`**/sessions/${baseId}/log**`, async (route) => {
    await route.fulfill({ body: '' })
  })

  await page.route('**/client-log', async (route) => {
    await route.fulfill({ status: 204, body: '' })
  })

  return baseId
}

test('messages area is scrollable and contained', async ({ page }) => {
  const id = await stubApi(page)
  await page.goto(`/s/${id}`)

  // Wait for messages to populate
  const root = page.locator('[data-testid="messages"]')
  await expect(root).toBeVisible()

  // Get the Radix viewport inside ScrollArea
  const viewport = root.locator('[data-radix-scroll-area-viewport]')
  await expect(viewport).toBeVisible()

  const metrics = await viewport.evaluate((el) => ({
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    scrollTop: el.scrollTop,
  }))

  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)

  // Scroll to bottom and verify scrollTop changes
  await viewport.evaluate((el) => { el.scrollTop = el.scrollHeight })
  const after = await viewport.evaluate((el) => el.scrollTop)
  expect(after).toBeGreaterThan(0)
})

