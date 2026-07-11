// Mobile header, language switcher, welcome copy, and legal-footer cleanup.
//
// Default route opens directly into the workspace. Mobile header is logo-only
// with a compact language control + phone + menu; the heavy legal block is
// replaced by a compact Company & Licensing link that opens a drawer. The old
// marketing landing is preserved at /?intro.

import { test, expect } from '@playwright/test';

const SIZES = [
  { w: 360, h: 800 }, { w: 375, h: 812 }, { w: 390, h: 844 }, { w: 393, h: 852 }, { w: 430, h: 932 },
];

const openLang = (page) => page.getByRole('button', { name: /Select language/ }).click();
async function selectChinese(page) {
  await openLang(page);
  await page.getByRole('button', { name: '简体中文' }).click();
}

// ── HEADER ──
test('mobile header is logo-only (no WCCI / company text beside it)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('img', { name: 'WCCI' }).first()).toBeVisible();     // the square mark
  await expect(page.getByText('by West Coast Capital Mortgage Inc.')).toHaveCount(0);
  await expect(page.getByText('WCCI', { exact: true })).toHaveCount(0);            // no WCCI text label
  // language, phone, menu actions all visible
  await expect(page.getByRole('button', { name: /Select language/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Contact West Coast/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Open menu/ })).toBeVisible();
});

test('no horizontal overflow at 360px (en + zh-CN)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  let ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(ov).toBeLessThanOrEqual(1);
  await selectChinese(page);
  ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(ov).toBeLessThanOrEqual(1);
});

for (const s of SIZES) {
  test(`no horizontal scroll at ${s.w}×${s.h}`, async ({ page }) => {
    await page.setViewportSize({ width: s.w, height: s.h });
    await page.goto('/');
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(ov).toBeLessThanOrEqual(1);
  });
}

// ── LANGUAGE ──
test('language control opens a sheet with all four languages; selection persists', async ({ page }) => {
  await page.goto('/');
  await openLang(page);
  for (const name of ['English', 'Español', 'Русский', '简体中文']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: '简体中文' }).click();
  await expect(page.getByText('房贷策略顾问')).toBeVisible();                    // welcome now Chinese
  await page.reload();
  await expect(page.getByText('房贷策略顾问')).toBeVisible();                    // persisted
});

test('switching language does not clear the chat, and the UI localizes', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').first().fill('I want to refinance in California');
  await page.keyboard.press('Enter');
  await expect(page.getByText('I want to refinance in California')).toBeVisible();
  await selectChinese(page);
  await expect(page.getByText('I want to refinance in California')).toBeVisible(); // chat preserved
  await expect(page.locator('textarea').first()).toHaveAttribute('placeholder', /输入/); // UI localized
});

// ── PHONE ──
test('phone icon opens a contact sheet (does not auto-dial); office/direct/email correct', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Contact West Coast/ }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Contact West Coast Capital Mortgage')).toBeVisible();
  await expect(dialog.getByText('(310) 654-1577')).toBeVisible();
  await expect(dialog.getByText('(310) 686-5053')).toBeVisible();
  await expect(dialog.locator('a[href="tel:+13106541577"]').first()).toBeVisible();
  await expect(dialog.locator('a[href="tel:+13106865053"]').first()).toBeVisible();
  await expect(dialog.locator('a[href="mailto:westccmortgage@gmail.com"]').first()).toBeVisible();
});

// ── MENU ──
test('menu contains the required destinations', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Open menu/ }).click();
  await expect(page.getByRole('menuitem', { name: /Start New Scenario/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Company & Licensing/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Privacy & AI Use/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Clear Saved Information/ })).toBeVisible();
});

test('Start New Scenario asks for confirmation before clearing', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').first().fill('buying in Boca Raton');
  await page.keyboard.press('Enter');
  await expect(page.getByText('buying in Boca Raton')).toBeVisible();
  await page.getByRole('button', { name: /Open menu/ }).click();
  await page.getByRole('menuitem', { name: /Start New Scenario/ }).click();
  await expect(page.getByRole('dialog').getByText(/Start a new scenario\?/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('buying in Boca Raton')).toBeVisible(); // cancel keeps chat
});

// ── WELCOME ──
test('welcome is short and does not force a name; user can start with a scenario', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/AI-assisted mortgage strategist/)).toBeVisible();
  await expect(page.getByText(/what should I call you/i)).toHaveCount(0);
  await page.locator('textarea').first().fill('$800k purchase in California, self-employed');
  await page.keyboard.press('Enter');
  await expect(page.getByText('$800k purchase in California, self-employed')).toBeVisible();
});

// ── LEGAL ──
test('heavy legal block is gone from below the composer; compact link opens the drawer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/Equal Housing Lender \|/)).toHaveCount(0);
  const link = page.getByRole('button', { name: /Company & Licensing/ }).last();
  await expect(link).toBeVisible();
  await link.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('NMLS #2817729')).toBeVisible();
  await expect(dialog.getByText('NMLS #2775380')).toBeVisible();
  await expect(dialog.getByText(/mortgage strategy platform operated for/i)).toBeVisible();
});

// ── PERSISTENCE / LANDING / WECHAT ──
test('conversation persists across a reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').first().fill('Buying in Boca Raton around 800k');
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
  await expect(page.getByText('房贷策略顾问')).toBeVisible();
});
