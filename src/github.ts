// Utilities related to GitHub remotes and URLs

// Build a GitHub compare URL from a remote URL (ssh or https) and branches.
// Returns null if the remote does not look like GitHub.
export function buildGithubCompareUrl(remoteUrl: string | undefined | null, base: string, head: string): string | null {
  if (!remoteUrl) return null
  let baseUrl = ''
  if (/^git@github\.com:/.test(remoteUrl)) {
    baseUrl = 'https://github.com/' + remoteUrl.replace(/^git@github\.com:/, '').replace(/\.git$/, '')
  } else if (/^https:\/\/github\.com\//.test(remoteUrl)) {
    baseUrl = remoteUrl.replace(/\.git$/, '')
  } else {
    return null
  }
  return `${baseUrl}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?expand=1`
}

