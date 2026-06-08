// ============================================================================
// Pegasus — Weekly digest Edge Function (Supabase / Deno)
// Compiles a per-member weekly brief (new members in your role, network
// showcase highlights, your due follow-ups, unread notifications) and emails it
// via Resend. Runs on a weekly cron (see README).
//
// Requires env (set as Supabase function secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (auto-available in Supabase)
//   RESEND_API_KEY                            (from resend.com)
//   DIGEST_FROM   e.g. "Pegasus <noreply@pegasuscapitalnetwork.com>"
//   SITE_URL      e.g. "https://pegasuscapitalnetwork.com"
//
// Test (single recipient, no broadcast):
//   curl -X POST "$FUNCTION_URL" -H "Authorization: Bearer $ANON" \
//     -H "Content-Type: application/json" -d '{"test":true,"email":"you@x.com","name":"You"}'
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY  = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM            = Deno.env.get("DIGEST_FROM") ?? "Pegasus <noreply@pegasuscapitalnetwork.com>";
const SITE            = Deno.env.get("SITE_URL") ?? "https://pegasuscapitalnetwork.com";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const WEEK_AGO  = () => new Date(Date.now() - 7 * 864e5).toISOString();
const WEEK_HENCE= () => new Date(Date.now() + 7 * 864e5).toISOString();

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function digestHtml(name: string, d: any) {
  const row = (label: string, items: string[]) =>
    !items.length ? "" :
    `<tr><td style="padding:18px 24px;border-top:1px solid #e7e2d8">
      <div style="font:600 11px/1 'Helvetica Neue',Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#8a8780">${esc(label)}</div>
      <div style="margin-top:10px">${items.join("")}</div></td></tr>`;

  const peers = (d.peers || []).map((p: any) =>
    `<div style="font:400 14px/1.5 Georgia,serif;color:#23211c;margin-bottom:4px">${esc(p.full_name || "A new member")}${p.company_name ? ` · <span style="color:#6b6862">${esc(p.company_name)}</span>` : ""}</div>`);
  const showcase = (d.showcase || []).map((s: any) =>
    `<div style="margin-bottom:8px"><span style="font:400 14px/1.4 Georgia,serif;color:#23211c">${esc(s.title)}</span>${s.location ? `<span style="font:400 12px/1.4 'Helvetica Neue',Arial,sans-serif;color:#8a8780"> — ${esc(s.location)}</span>` : ""}</div>`);
  const reminders = (d.reminders || []).map((r: any) =>
    `<div style="font:400 13px/1.5 'Helvetica Neue',Arial,sans-serif;color:#3a3833;margin-bottom:4px">○ ${esc(r.title)} <span style="color:#a3a099">· ${new Date(r.due_at).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span></div>`);

  return `<!doctype html><html><body style="margin:0;background:#f4f1ea;padding:24px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fbfaf6;border:1px solid #e7e2d8;border-radius:14px;overflow:hidden">
    <tr><td style="padding:24px 24px 8px">
      <div style="font:600 12px/1 'Helvetica Neue',Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#235fa6">Pegasus Capital Network</div>
      <div style="font:400 24px/1.2 Georgia,serif;color:#23211c;margin-top:10px">Your weekly brief</div>
      <div style="font:400 14px/1.6 'Helvetica Neue',Arial,sans-serif;color:#6b6862;margin-top:6px">Hi ${esc(name)} — here's what moved in your network this week.</div>
    </td></tr>
    ${row(`New members${d.role ? " in your space" : ""}`, peers)}
    ${row("Featured opportunities", showcase)}
    ${row("Your follow-ups due", reminders)}
    ${d.unread ? `<tr><td style="padding:14px 24px;border-top:1px solid #e7e2d8"><div style="font:400 13px/1.5 'Helvetica Neue',Arial,sans-serif;color:#235fa6">You have ${d.unread} unread notification${d.unread === 1 ? "" : "s"} waiting.</div></td></tr>` : ""}
    <tr><td style="padding:22px 24px;border-top:1px solid #e7e2d8;text-align:center">
      <a href="${esc(SITE)}/dashboard.html" style="display:inline-block;background:#235fa6;color:#fff;text-decoration:none;font:600 14px/1 'Helvetica Neue',Arial,sans-serif;padding:13px 26px;border-radius:8px">Open your workspace →</a>
      <div style="font:400 11px/1.5 'Helvetica Neue',Arial,sans-serif;color:#a3a099;margin-top:16px">Where Capital Meets Opportunity</div>
    </td></tr>
  </table></body></html>`;
}

Deno.serve(async (req) => {
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    const { data: newMembers } = await admin.from("profiles")
      .select("full_name,role,company_name,created_at").gte("created_at", WEEK_AGO()).limit(50);
    const { data: newShowcase } = await admin.from("showcase_items")
      .select("title,category,location,created_at").eq("status", "active")
      .gte("created_at", WEEK_AGO()).order("created_at", { ascending: false }).limit(6);

    let recipients: any[];
    if (body.test && body.email) {
      recipients = [{ id: null, email: body.email, full_name: body.name || "there", role: null }];
    } else {
      const { data } = await admin.from("profiles").select("id,email,full_name,role").not("email", "is", null);
      recipients = data || [];
    }

    let sent = 0, failed = 0;
    for (const m of recipients) {
      if (!m.email) continue;
      let reminders: any[] = [], unread = 0;
      if (m.id) {
        const { data: rem } = await admin.from("crm_reminders").select("title,due_at")
          .eq("owner_id", m.id).eq("done", false).lte("due_at", WEEK_HENCE()).order("due_at").limit(8);
        reminders = rem || [];
        const { count } = await admin.from("notifications").select("id", { count: "exact", head: true })
          .eq("user_id", m.id).eq("read", false);
        unread = count || 0;
      }
      const peers = (newMembers || []).filter((x: any) => (m.role ? x.role === m.role : true)).slice(0, 5);
      // skip empty digests on the broadcast path
      if (!body.test && !peers.length && !(newShowcase || []).length && !reminders.length && !unread) continue;
      const html = digestHtml(m.full_name || "there", { peers, showcase: newShowcase || [], reminders, unread, role: m.role });
      try { await sendEmail(m.email, "Your weekly Pegasus brief", html); sent++; }
      catch (e) { failed++; console.error("send fail", m.email, String(e)); }
    }
    return new Response(JSON.stringify({ ok: true, sent, failed }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
