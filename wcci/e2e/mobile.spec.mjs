// Mobile + Simplified Chinese end-to-end checks.
//
// The DEFAULT route now opens directly into the strategy workspace (no landing
// click). The old marketing landing is preserved only at /?intro. Covers: direct
// workspace entry, zh-CN, header brand lockup, trust panel + office/direct
// tap-to-call, no horizontal scroll at 360/390/430, conversation persistence,
// WeChat UA smoke, and landing-route preservation. IME composition is unit-tested
// in test/ime-composer.test.mjs.

import { test, expect } from '@playwright/test';

const SIZES = [
  { w: 360, h: 800 },
  { w: 375, h: 812 },
  { w: 390, h: 844 },
  { w: 393, h: 852 },
  { w: 430, h: 932 },
];

const selectChinese = (page) => page.getByRole('button', { name: /Language: 中文/ }).click();

test('default route opens directly into the workspace (no landing click)', async ({ page }) => {
  await page.goto('/');
  // Composer + assistant intro are present immediately — no "Build My Strategy" gate.
  await expect(page.locator('textarea').first()).toBeVisible();
  await expect(page.getByText(/Loan Strategy assistant/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Build My Strategy' })).toHaveCount(0);
});

test('workspace header shows WCCI by the legal company', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('WCCI', { exact: true })).toBeVisible();
  await expect(page.getByText('West Coast Capital Mortgage Inc.').first()).toBeVisible();
});

test('zh-CN switches the workspace into Chinese', async ({ page }) => {
  await page.goto('/');
  await selectChinese(page);
  await expect(page.getByText('贷款策略助手')).toBeVisible();
});

test('trust panel exposes licensing + office/direct tap-to-call from the workspace', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Company & Licensing/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('NMLS #2817729')).toBeVisible();
  await expect(dialog.getByText('NMLS #2775380')).toBeVisible();
  await expect(dialog.locator('a[href="tel:+13106541577"]').first()).toBeVisible();
  await expect(dialog.locator('a[href="tel:+13106865053"]').first()).toBeVisible();
});

for (const s of SIZES) {
  test(`no horizontal scroll at ${s.w}×${s.h} (en + zh-CN)`, async ({ page }) => {
    await page.setViewportSize({ width: s.w, height: s.h });
    await page.goto('/');
    let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `en overflow at ${s.w}`).toBeLessThanOrEqual(1);
    await selectChinese(page);
    overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `zh overflow at ${s.w}`).toBeLessThanOrEqual(1);
  });
}

test('conversation persists across a reload (returning from an external resource)', async ({ page }) => {
  await page.goto('/');
  const box = page.locator('textarea').first();
  await box.fill('Buying in Boca Raton around 800k');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Buying in Boca Raton around 800k')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Buying in Boca Raton around 800k')).toBeVisible();
});

test('the old landing is preserved only at /?intro', async ({ page }) => {
  await page.goto('/?intro');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /Build My Strategy/ })).toBeVisible();
});

test('WeChat user-agent renders the workspace and language selection works', async ({ page }) => {
  const ua = await page.evaluate(() => navigator.userAgent);
  test.skip(!/MicroMessenger/.test(ua), 'only meaningful in the wechat-embedded project');
  await page.goto('/');
  await expect(page.locator('textarea').first()).toBeVisible();
  await selectChinese(page);
  await expect(page.getByText('贷款策略助手')).toBeVisible();
});
