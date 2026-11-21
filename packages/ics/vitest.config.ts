import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// AD-15: the node environment, never jsdom. The domain is read from its
// source, as `apps/web` reads it, so these tests need no build.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@shift\/domain$/, replacement: fileURLToPath(new URL('../domain/src/index.ts', import.meta.url)) }],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
