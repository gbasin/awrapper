export function layout(title: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; margin: 1rem; }
    a { color: #0366d6; text-decoration: none; }
    a:hover { text-decoration: underline; }
    table { border-collapse: collapse; width: 100%; }
    th, td { padding: 6px 8px; border-bottom: 1px solid #eee; text-align: left; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
    .muted { color: #666; }
    .row { display: flex; gap: 12px; align-items: center; }
    input, select, button, textarea { font-size: 16px; padding: 6px 8px; }
    textarea { width: 100%; height: 96px; }
    .log { background: #0b0b0b; color: #d6d6d6; padding: 8px; border-radius: 6px; height: 260px; overflow: auto; }
  </style>
  </head>
  <body>
    ${body}
  </body>
</html>`;
}

export function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

