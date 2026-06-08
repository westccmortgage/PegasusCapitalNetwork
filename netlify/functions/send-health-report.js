/**
 * PEGASUS — send-health-report Netlify Function (Phase 2)
 * Sends the health report to HEALTH_REPORT_EMAIL if configured.
 * If the env var is missing, silently returns 200 — does not fail.
 *
 * POST /.netlify/functions/send-health-report
 * Authorization: Bearer <supabase-access-token>
 * Body: { report: { ... health report object ... } }
 *
 * Email delivery: uses Resend API if RESEND_API_KEY is set,
 * otherwise logs the report and returns success.
 * Set HEALTH_REPORT_EMAIL in Netlify env vars to enable.
 */

'use strict';

exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  /* If not configured, silently succeed */
  const toEmail = process.env.HEALTH_REPORT_EMAIL;
  if (!toEmail) {
    return { statusCode: 200, headers, body: JSON.stringify({ sent: false, reason: 'HEALTH_REPORT_EMAIL not configured' }) };
  }

  let report;
  try {
    const body = JSON.parse(event.body || '{}');
    report = body.report;
    if (!report) throw new Error('No report in body');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid body: ' + e.message }) };
  }

  const { score, status, critical_count, warning_count, summary, generated_at } = report;
  const ts = new Date(generated_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }) + ' PT';
  const statusIcon = status === 'healthy' ? '✅' : status === 'degraded' ? '⚠️' : '🔴';

  const allIssues = report.issues || (report.checks || []).flatMap(c => c.issues || []);
  const criticalIssues = allIssues.filter(i => i.severity === 'CRITICAL');
  const warningIssues  = allIssues.filter(i => i.severity === 'WARNING');

  const issueHtml = (items, color) => items.length === 0 ? '' :
    items.map(i => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;color:#666">${i.check}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px">${i.message}</td></tr>`).join('');

  const htmlBody = `
<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#333">
<h2 style="margin:0 0 4px">${statusIcon} Pegasus Platform Health Report</h2>
<p style="color:#888;font-size:12px;margin:0 0 20px">${ts}</p>
<div style="background:#f5f5f5;border-radius:8px;padding:16px;margin-bottom:20px;display:flex;gap:24px;flex-wrap:wrap">
  <div style="text-align:center"><div style="font-size:32px;font-weight:700;color:${score>=90?'#16a34a':score>=70?'#d97706':'#dc2626'}">${score}</div><div style="font-size:11px;color:#888">Score / 100</div></div>
  <div style="text-align:center"><div style="font-size:24px;font-weight:600;color:#dc2626">${critical_count}</div><div style="font-size:11px;color:#888">Critical</div></div>
  <div style="text-align:center"><div style="font-size:24px;font-weight:600;color:#d97706">${warning_count}</div><div style="font-size:11px;color:#888">Warning</div></div>
</div>
<p style="font-size:13px">${summary}</p>
${criticalIssues.length ? `<h3 style="color:#dc2626;font-size:13px;margin:16px 0 6px">🔴 Critical Issues</h3><table style="width:100%;border-collapse:collapse">${issueHtml(criticalIssues,'#dc2626')}</table>` : ''}
${warningIssues.length  ? `<h3 style="color:#d97706;font-size:13px;margin:16px 0 6px">🟠 Warnings</h3><table style="width:100%;border-collapse:collapse">${issueHtml(warningIssues,'#d97706')}</table>` : ''}
<hr style="border:none;border-top:1px solid #eee;margin:20px 0">
<p style="font-size:11px;color:#aaa">Pegasus Lenders Group LLC — Admin Health Monitor · pegasuscapitalnetwork.com</p>
</body></html>`;

  const textBody = `Pegasus Platform Health Report\n${ts}\n\nScore: ${score}/100 | Status: ${status.toUpperCase()}\n${summary}\n\n${
    criticalIssues.length ? 'CRITICAL:\n' + criticalIssues.map(i => `  - [${i.check}] ${i.message}`).join('\n') + '\n\n' : ''
  }${warningIssues.length ? 'WARNINGS:\n' + warningIssues.map(i => `  - [${i.check}] ${i.message}`).join('\n') : ''}`;

  /* ── Try Resend API ── */
  if (process.env.RESEND_API_KEY) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Pegasus Admin <noreply@pegasuslendersgroup.com>',
          to: [toEmail],
          subject: `${statusIcon} Pegasus Health: ${status.toUpperCase()} (Score ${score}/100)`,
          html: htmlBody,
          text: textBody,
        }),
      });
      if (resp.ok) {
        return { statusCode: 200, headers, body: JSON.stringify({ sent: true, to: toEmail, via: 'resend' }) };
      }
      const err = await resp.text().catch(() => resp.status);
      console.error('[send-health-report] Resend error:', err);
    } catch (e) {
      console.error('[send-health-report] Resend threw:', e.message);
    }
  }

  /* ── Fallback: just log it ── */
  console.log('[HEALTH REPORT]', textBody);
  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      sent: false,
      reason: process.env.RESEND_API_KEY ? 'Resend API failed — check logs' : 'Set RESEND_API_KEY to enable email delivery',
      logged: true,
      to: toEmail,
    }),
  };
};
