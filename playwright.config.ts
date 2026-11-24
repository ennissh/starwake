import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Smoke tests drive the BUILT server (the real path), in mock LLM mode, with a throwaway data dir.
const PORT = Number(process.env.E2E_PORT ?? 8799);
const dataDir = mkdtempSync(join(tmpdir(), 'starwake-e2e-'));
// Cloud dev containers ship a Chromium at this path; elsewhere run `npx playwright install chromium`.
const preinstalled = '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    launchOptions: existsSync(preinstalled) ? { executablePath: preinstalled } : {},
  },
  webServer: {
    command: 'node apps/server/dist/index.js',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      LISTEN_PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      LLM_MODE: 'mock',
      LOG_LEVEL: 'warn',
      STARWAKE_VERSION: 'e2e',
    },
  },
});
