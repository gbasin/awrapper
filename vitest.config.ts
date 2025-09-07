import { defineConfig } from 'vitest/config';
import os from 'node:os';

// Use multiple workers so test files run in parallel
const cpuCount = os.cpus()?.length ?? 1;
const maxWorkers = Math.max(2, cpuCount - 1);

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30000,
    // Run test files in parallel using separate processes for strong isolation
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: maxWorkers,
        minForks: 1
      }
    },
    coverage: {
      reporter: ['lcov', 'html']
    },
    // Exclude tool-generated worktrees to avoid duplicate test runs
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.awrapper-worktrees/**',
      // Exclude Playwright e2e tests under the web app from Vitest collection
      'web/tests/**'
    ]
  }
});
