/**
 * PEGASUS — Scheduled Weekly Health Check
 * Runs every Monday at 15:00 UTC = 8:00 AM PDT (Los Angeles).
 * Note: During PST (Nov–Mar) this fires at 7:00 AM LA time.
 * This is the standard tradeoff for cron-without-DST-support.
 *
 * Schedule config lives in netlify.toml:
 *   [functions."scheduled-health-check"]
 *     schedule = "0 15 * * 1"
 *
 * Env vars required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 *   STRIPE_PRICE_STARTER_MONTHLY
 *   STRIPE_PRICE_PRO_MONTHLY
 *   STRIPE_PRICE_GOLD_MONTHLY
 *
 * Env vars optional (enable delivery):
 *   HEALTH_REPORT_EMAIL      — recipient address
 *   RESEND_API_KEY           — enables email via Resend
 *   TELEGRAM_BOT_TOKEN       — enables Telegram alerts
 *   TELEGRAM_CHAT_ID         — target Telegram chat
 *   URL or DEPLOY_URL        — site base URL (Netlify injects automatically)
 */

'use strict';

const { runAllChecks, saveReport, sendEmail, sendTelegram } = require('./lib/health-core');

exports.handler = async function (event) {
  const start = Date.now();
  console.log('[scheduled-health-check] Starting weekly health check…');
  console.log('[scheduled-health-check] Triggered at:', new Date().toISOString());

  /* Netlify sets process.env.URL to the site's primary domain */
  const BASE_URL = process.env.URL || process.env.DEPLOY_URL || 'https://pegasuscapitalnetwork.com';
  console.log('[scheduled-health-check] Base URL:', BASE_URL);

  let report;
  try {
    report = await runAllChecks(BASE_URL, 'scheduled');
    console.log(`[scheduled-health-check] Checks complete — Status: ${report.status} Score: ${report.score}/100`);
    console.log(`[scheduled-health-check] Critical: ${report.critical_count} | Warnings: ${report.warning_count}`);
  } catch (err) {
    console.error('[scheduled-health-check] runAllChecks threw:', err.message);
    /* Even if checks crash, record the failure */
    report = {
      source: 'scheduled',
      generated_at: new Date().toISOString(),
      status: 'critical',
      score: 0,
      critical_count: 1,
      warning_count: 0,
      info_count: 0,
      summary: `CRITICAL: Health check function crashed — ${err.message}`,
      top_issues: [{ severity: 'CRITICAL', check: 'System', message: err.message }],
      checks: {},
      delivery: {
        emailConfigured:    !!process.env.HEALTH_REPORT_EMAIL,
        telegramConfigured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
        resendConfigured:   !!process.env.RESEND_API_KEY,
      },
    };
  }

  /* ── Save to Supabase ── */
  let savedId = null;
  try {
    savedId = await saveReport(report, null); /* null = no user, system-initiated */
    console.log('[scheduled-health-check] Report saved to health_reports, id:', savedId);
  } catch (saveErr) {
    console.error('[scheduled-health-check] Failed to save report:', saveErr.message);
  }

  /* ── Email delivery ── */
  let emailResult = { sent: false, reason: 'Not configured' };
  if (process.env.HEALTH_REPORT_EMAIL && process.env.RESEND_API_KEY) {
    try {
      emailResult = await sendEmail(report);
      console.log('[scheduled-health-check] Email result:', JSON.stringify(emailResult));
    } catch (emailErr) {
      console.error('[scheduled-health-check] Email threw:', emailErr.message);
      emailResult = { sent: false, error: emailErr.message };
    }
  } else {
    console.log('[scheduled-health-check] Email skipped — HEALTH_REPORT_EMAIL or RESEND_API_KEY not set');
  }

  /* ── Telegram delivery ── */
  let telegramResult = { sent: false, reason: 'Not configured' };
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      telegramResult = await sendTelegram(report);
      console.log('[scheduled-health-check] Telegram result:', JSON.stringify(telegramResult));
    } catch (tgErr) {
      console.error('[scheduled-health-check] Telegram threw:', tgErr.message);
      telegramResult = { sent: false, error: tgErr.message };
    }
  } else {
    console.log('[scheduled-health-check] Telegram skipped — TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set');
  }

  const elapsed = Date.now() - start;
  console.log(`[scheduled-health-check] Done in ${elapsed}ms`);

  return {
    statusCode: 200,
    body: JSON.stringify({
      status:    report.status,
      score:     report.score,
      critical:  report.critical_count,
      warnings:  report.warning_count,
      savedId,
      email:     emailResult,
      telegram:  telegramResult,
      elapsedMs: elapsed,
    }),
  };
};
