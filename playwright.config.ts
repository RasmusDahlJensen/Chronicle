import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  // Scenarios share two bounded real hosts. CPU-count concurrency can overload
  // response admission (including StrictMode mounts) before the map loads.
  workers: 2,
  outputDir: 'test-results/playwright',
  reporter: [['list'], ['html', { open: 'never' }]],
  // Real tectonic generation has a 20s admission deadline; UI checks must allow
  // that bounded request to finish, including the manifest's rendering work.
  timeout: 60_000,
  expect: { timeout: 25_000 },
  use: {
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'development',
      use: { baseURL: 'http://127.0.0.1:4173' },
    },
    {
      name: 'production',
      testIgnore: /reload\.spec\.ts/,
      use: { baseURL: 'http://127.0.0.1:4174' },
    },
  ],
  webServer: [
    {
      command: 'npm start -- --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      // Scenarios run in parallel on several worlds; keep each world's simulation alive while its scenario runs.
      env: { CHRONICLE_SIMULATIONS: '8' },
    },
    {
      command: 'npm run serve -- --port 4174',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: false,
      env: { CHRONICLE_SIMULATIONS: '8' },
    },
  ],
});
