import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30000,
    // Exclude tool-generated worktrees to avoid duplicate test runs
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.awrapper-worktrees/**'
    ]
  }
});
