import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:48173',
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:48173',
    reuseExistingServer: !process.env.CI,
  },
});
