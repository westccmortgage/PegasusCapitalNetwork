// Mobile + Simplified Chinese end-to-end checks.
//
// Covers: zh-CN selection, Chinese landing copy, mobile trust panel, office/direct
// tap-to-call, no horizontal scroll at 360/390/430, conversation persistence,
// and a WeChat user-agent rendering smoke test. IME composition itself is
// unit-tested in test/ime-composer.test.mjs (composition events are not reliably
// synthesizable in a headless driver).

import { test, expect } from '@playwright/test';

const SIZES = [
  { w: 360, h: 800 },
  { w: 375, h: 812 },
  { w: 390, h: 844 },
  { w: 393, h: 852 },
  { w: 430, h: 932 },
];

async function selectChinese(page) {
  await page.getByRole('button', { name: /Language: 中文/ }).click();
}

test('zh-CN selection switches the landing headline to Chinese', async ({ page }) => {
  await page.goto('/');
  await selectChinese(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('房贷策略');
  await expect(page.getByRole('button', { name: '生成我的策略' })).toBeVisible();
  await expect(page.getByRole('button', { name: '逐步输入信息' })).toBeVisible();
});

test('brand lockup shows WCCI by the legal company (not an AI-company headline)', async ({ page }) => {
  await page.goto('/');
  const nav = page.locator('nav');
  await expect(nav.getByText('WCCI', { exact: true })).toBeVisible();
  await expect(nav.getByText('West Coast Capital Mortgage Inc.')).toBeVisible();
});

test('mobile trust panel exposes licensing + office/direct tap-to-call', async ({ page }) => {
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
  await page.getByRole('button', { name: /Build My Strategy|生成我的策略/ }).first().isVisible().catch(() => {});
  // Enter the chat and send a message.
  await page.getByRole('button', { name: /Enter Details Step by Step|逐步输入信息/ }).first().click();
  const box = page.locator('textarea').first();
  await box.fill('Buying in Boca Raton around 800k');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Buying in Boca Raton around 800k')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Buying in Boca Raton around 800k')).toBeVisible();
});

test('WeChat user-agent renders the page and language selection works', async ({ page }) => {
  const ua = await page.evaluate(() => navigator.userAgent);
  test.skip(!/MicroMessenger/.test(ua), 'only meaningful in the wechat-embedded project');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await selectChinese(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('房贷策略');
});
