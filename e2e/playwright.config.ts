import { defineConfig, devices } from '@playwright/test';

/**
 * The host matters more than anything else in this file.
 *
 * Browsers treat `localhost` and `127.0.0.1` as a secure context, so they happily store a
 * `Secure` cookie over plain http and a `Domain` mismatch never shows up. Testing there would
 * pass while the real bug survives. So the suite reaches the app as `dev.example.test`, mapped
 * back to the loopback address by the browser resolver, and every cookie rule is judged the way
 * a real browser on a real host judges it.
 */
const HOST = 'dev.example.test';
const PORT = 3100;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] },
      },
    },
  ],
  webServer: {
    command: 'pnpm --filter @conciergekit/playground-next start',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    cwd: '..',
  },
});
