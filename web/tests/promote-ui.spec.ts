import { test, expect, Page } from '@playwright/test'

async function stubApi(page: Page) {
  const id = 'sess-promote'
  const now = Date.now()
  let promoteBody: any = null
  let openedUrls: string[] = []

  // Capture window.open calls
  await page.addInitScript(() => {
    // @ts-ignore
    window.__opened = []
    const orig = window.open
    // @ts-ignore
    window.open = (url: any, target?: any, features?: any) => {
      // @ts-ignore
      window.__opened.push(String(url))
      if (orig) return orig.call(window, url, target, features)
      // @ts-ignore
      return null
    }
  })

  await page.route('**/config', async (route) => {
    await route.fulfill({ json: { default_use_worktree: true, enable_promote: true } })
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

  await page.route(`**/sessions/${id}/log**`, async (route) => { await route.fulfill({ body: '' }) })
  await page.route('**/client-log', async (route) => { await route.fulfill({ status: 204, body: '' }) })

  await page.route(`**/sessions/${id}/changes`, async (route) => {
    await route.fulfill({ json: { gitAvailable: true, head: 'HEAD', staged: [], unstaged: [] } })
  })

  await page.route(`**/sessions/${id}/promote/preflight`, async (route) => {
    await route.fulfill({ json: { enable_promote: true, gitAvailable: true, ghAvailable: false, remote: 'origin', remoteUrl: 'https://github.com/owner/repo.git', defaultBranch: 'main', currentBranch: 'main', onDefaultBranch: true, ahead: 0, behind: 0, stagedCount: 0, unstagedCount: 0, uncommitted: false } })
  })

  const expectedCompare = 'https://github.com/owner/repo/compare/main...awrapper/sess-pro?expand=1'
  await page.route(`**/sessions/${id}/promote`, async (route) => {
    promoteBody = JSON.parse(route.request().postData() || '{}')
    await route.fulfill({ json: { ok: true, branch: promoteBody.branch || 'awrapper/sess-pro', pushed: true, compareUrl: expectedCompare } })
  })

  return {
    id,
    getPromoteBody: () => promoteBody,
    getOpened: async () => {
      openedUrls = await page.evaluate(() => (window as any).__opened || [])
      return openedUrls
    },
    expectedCompare,
  }
}

test('promote dialog submits and opens compare URL', async ({ page }) => {
  const { id, getPromoteBody, getOpened, expectedCompare } = await stubApi(page)
  await page.goto(`/s/${id}`)

  // Open Promote dialog
  await page.getByRole('button', { name: 'Promote…' }).click()
  await expect(page.getByRole('dialog', { name: 'Promote to repo' })).toBeVisible()

  // Enter commit message
  const dlg = page.getByRole('dialog', { name: 'Promote to repo' })
  await dlg.getByPlaceholder('e.g. feat: add changes review UI').fill('test promote')

  // Submit Promote
  await dlg.getByRole('button', { name: 'Promote', exact: true }).click()

  // Assert request payload and opened URL
  await expect.poll(() => getPromoteBody()).not.toBeNull()
  const body = getPromoteBody()
  expect(body.message).toBe('test promote')
  // Suggested branch based on session id prefix
  expect(typeof body.branch === 'string' && body.branch.startsWith('awrapper/')).toBe(true)

  await expect.poll(async () => (await getOpened())[0]).toBe(expectedCompare)
})

