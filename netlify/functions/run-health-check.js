/**
 * PEGASUS — Manual Health Check (Admin-triggered)
 * POST /.netlify/functions/run-health-check
 * Authorization: Bearer <supabase-access-token>
 *
 * Verifies the caller is an authenticated admin, runs all checks
 * via health-core.js, saves to health_reports, returns full report.
 * Secrets never reach the browser.
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { runAllChecks, saveReport, sendEmail, sendTelegram } = require('./lib/health-core');

exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST required' }) };

  /* ── Auth: verify admin JWT ── */
  const token = (event.headers['authorization'] || event.headers['Authorization'] || '').replace(/^Bearer\s+/, '');
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'No auth token' }) };

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_SR  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPA_URL || !SUPA_SR) {
    /* Supabase not configured — still run checks but skip DB operations */
    const report = await runAllChecks(process.env.URL || 'https://pegasuscapitalnetwork.com', 'manual');
    return { statusCode: 200, headers, body: JSON.stringify(report) };
  }

  const admin = createClient(SUPA_URL, SUPA_SR, { auth: { persistSession: false } });

  /* Verify token */
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired session' }) };

  /* Verify admin role */
  const { data: profile } = await admin.from('profiles').select('role,is_admin').eq('id', user.id).single();
  if (!profile || (profile.role !== 'admin' && !profile.is_admin)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin access required' }) };
  }

  /* ── Run all checks ── */
  const BASE_URL = process.env.URL || process.env.DEPLOY_URL || 'https://pegasuscapitalnetwork.com';
  const report   = await runAllChecks(BASE_URL, 'manual');

  /* ── Save report ── */
  const savedId = await saveReport(report, user.id);

  /* ── Optional email on manual critical runs ── */
  if (report.critical_count > 0 && process.env.HEALTH_REPORT_EMAIL && process.env.RESEND_API_KEY) {
    sendEmail(report).catch(e => console.error('[run-health-check] email error:', e.message));
  }

  /* ── Optional Telegram on critical ── */
  if (report.critical_count > 0 && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    sendTelegram(report).catch(e => console.error('[run-health-check] telegram error:', e.message));
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ...report, savedId }),
  };
};
