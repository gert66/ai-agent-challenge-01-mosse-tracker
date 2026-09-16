import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // tests/e2e/*.spec.ts are Playwright specs (run via `npm run test:e2e`),
    // not Vitest tests — Vitest's default include pattern would otherwise
    // also try to load them as unit tests and fail.
    include: ['tests/unit/**/*.test.ts'],
  },
});
