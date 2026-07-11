// Playwright mobile config for WCCI.
//
// Projects model the required device classes:
//   • iPhone-size Safari/WebKit  (requires a WebKit build)
//   • Android-size Chromium
//   • WeChat-like embedded browser (Chromium + MicroMessenger UA)
//
// Run:  npm run test:e2e        (builds, previews on :4173, runs specs)
// Chromium is pre-installed in this environment (PLAYWRIGHT_BROWSERS_PATH).
// WebKit is only exercised where a WebKit build is available.

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

// This environment ships a pinned Chromium build; point Playwright at it rather
// than downloading a version-matched browser. (No WebKit build is present, so
// the iphone-webkit project is expected to be skipped here.)
const CHROMIUM = process.env.WCCI_CHROMIUM || '/opt/pw-browsers/chromium';
const chromiumLaunch = { executablePath: CHROMIUM };

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'on-first-retry' },
  webServer: {
    command: 'npm run build && npm run preview -- --port ' + PORT + ' --strictPort',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120000,
  },
  projects: [
    { name: 'android-chromium', use: { ...devices['Pixel 5'], launchOptions: chromiumLaunch } },   // 393×851
    { name: 'iphone-webkit', use: { ...devices['iPhone 12'] } },                                    // 390×844 (WebKit; skipped without a WebKit build)
    {
      name: 'wechat-embedded',
      use: {
        ...devices['Pixel 5'],
        launchOptions: chromiumLaunch,
        userAgent:
          'Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 MMWEBID/1234 MicroMessenger/8.0.40.2420(0x28002837) WeChat/arm64 NetType/WIFI Language/zh_CN',
      },
    },
  ],
});
