import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/listener/test/**/*.test.{ts,tsx}',
    ],
    environmentMatchGlobs: [['apps/listener/test/**', 'jsdom']],
    setupFiles: ['./test/setup.ts'],
    coverage: {
      reporter: ['text-summary'],
      include: ['packages/*/src/**', 'apps/listener/src/**'],
    },
  },
});
