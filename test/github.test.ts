import { describe, it, expect } from 'vitest'
import { buildGithubCompareUrl } from '../src/github.js'

describe('buildGithubCompareUrl', () => {
  it('builds from ssh remote', () => {
    const u = buildGithubCompareUrl('git@github.com:owner/repo.git', 'main', 'feature/x')
    expect(u).toBe('https://github.com/owner/repo/compare/main...feature%2Fx?expand=1')
  })
  it('builds from https remote', () => {
    const u = buildGithubCompareUrl('https://github.com/owner/repo.git', 'dev', 'awrapper/1234')
    expect(u).toBe('https://github.com/owner/repo/compare/dev...awrapper%2F1234?expand=1')
  })
  it('returns null for non-github remotes', () => {
    const u = buildGithubCompareUrl('git@example.com:owner/repo.git', 'main', 'x')
    expect(u).toBeNull()
  })
})

