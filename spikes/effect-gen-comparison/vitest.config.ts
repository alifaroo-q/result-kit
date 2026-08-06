import { defineConfig } from 'vitest/config';

// Spike-local runner. Files are named `*.spike.ts` precisely so the ROOT
// vitest (default include: **/*.spec.ts) never collects them — this suite is
// throwaway research, not part of the package's green bar.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['experiments/**/*.spike.ts'],
  },
});
