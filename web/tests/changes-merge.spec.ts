import { test, expect, Page } from '@playwright/test'

async function stubApi(page: Page) {
  const id = 'sess-merge'
  const now = Date.now()
  let putBody: any = null
  let stageCalled = false

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

  await page.route(`**/sessions/${id}/log**`, async (route) => { await route.fulfill({ body: '' }) })
  await page.route('**/client-log', async (route) => { await route.fulfill({ status: 204, body: '' }) })

  await page.route(`**/sessions/${id}/changes`, async (route) => {
    await route.fulfill({ json: { gitAvailable: true, head: 'HEAD', staged: [], unstaged: [{ path: 'foo.txt', status: 'M' }] } })
  })

  await page.route(`**/sessions/${id}/diff**`, async (route) => {
    await route.fulfill({ json: { isBinary: false, diff: '--- a/foo.txt\n+++ b/foo.txt\n@@ -1,1 +1,1 @@\n-hello\n+hello world\n' } })
  })

  await page.route(`**/sessions/${id}/file**`, async (route) => {
    const url = new URL(route.request().url())
    const path = url.searchParams.get('path')
    const rev = url.searchParams.get('rev')
    if (route.request().method() === 'PUT') {
      putBody = JSON.parse(route.request().postData() || '{}')
      return route.fulfill({ json: { ok: true } })
    }
    if (path === 'foo.txt' && rev === 'head') {
      return route.fulfill({ json: { content: 'hello\n', etag: 'etag-head' } })
    }
    if (path === 'foo.txt' && rev === 'worktree') {
      return route.fulfill({ json: { content: 'hello world\n', etag: 'etag-wt' } })
    }
    return route.continue()
  })

  // Handle PUT /file in the same handler to avoid overlap

  await page.route(`**/sessions/${id}/git`, async (route) => {
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}')
      if (body.op === 'stage') stageCalled = true
      return route.fulfill({ json: { ok: true } })
    }
    return route.continue()
  })

  return { id, getPut: () => putBody, getStage: () => stageCalled }
}

test('merge view saves and stages', async ({ page }) => {
  const { id, getPut, getStage } = await stubApi(page)
  await page.goto(`/s/${id}`)

  // Expand the single changed file
  const fileRow = page.getByText('foo.txt')
  await expect(fileRow).toBeVisible()
  await fileRow.click()

  // Switch to Merge mode
  await page.getByRole('button', { name: 'Merge' }).click()
  // Save
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  // Verify PUT /file was called with expected payload
  await expect.poll(() => getPut()).not.toBeNull()
  const put = getPut()
  expect(put.path).toBe('foo.txt')
  expect(put.expected_etag).toBe('etag-wt')

  // Verify stage was NOT called when saving only
  await expect.poll(() => getStage()).toBe(false)
})

test('merge view save & stage triggers stage', async ({ page }) => {
  const { id, getPut, getStage } = await stubApi(page)
  await page.goto(`/s/${id}`)

  // Expand the changed file
  const fileRow = page.getByText('foo.txt')
  await expect(fileRow).toBeVisible()
  await fileRow.click()

  // Switch to Merge and Save & Stage
  await page.getByRole('button', { name: 'Merge' }).click()
  await page.getByRole('button', { name: 'Save & Stage' }).click()

  // Ensure save occurred
  await expect.poll(() => getPut()).not.toBeNull()
  // Stage should be called
  await expect.poll(() => getStage()).toBe(true)
})
