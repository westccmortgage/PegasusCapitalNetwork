// ============================================================================
// PEGASUS NETWORK — Concierge profile builder (scheduled)
// netlify/functions/concierge-build.js
//
// For invitees who clicked "Yes" (pn_invite_consent.status='consented' and
// provisioned_at IS NULL), this provisions a free account and emails them a
// branded activation link so they can log in, review and publish the profile we
// started for them. Consent-first: only acts on rows that already consented.
//
// Runs on a schedule (see netlify.toml). Idempotent — provisioned_at guards
// against re-provisioning / re-emailing. All server-side (service_role +
// Resend REST); no per-email approval prompts.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
// ============================================================================
"use strict";

const ORIGIN = "https://pegasuscapitalnetwork.com";
const FROM = "Pegasus Capital Network <invites@pegasuscapitalnetwork.com>";
const REPLY_TO = "info@pegasuscapitalnetwork.com";
const ADDRESS = "Pegasus Capital Network · 150 E Olive Ave, Unit 112, Burbank, CA 91502";
const BATCH = 40; // max provisioned per run

function need(name){ const v = process.env[name]; if(!v) throw new Error("Missing env "+name); return v; }
function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

async function sbFetch(path, opts){
  const url = need("SUPABASE_URL").replace(/\/$/,"");
  const key = need("SUPABASE_SERVICE_ROLE_KEY");
  const h = Object.assign({ apikey:key, Authorization:"Bearer "+key, "Content-Type":"application/json" }, (opts&&opts.headers)||{});
  return fetch(url+path, Object.assign({}, opts, { headers:h }));
}

// Create (or, if already registered, re-link) the auth user and return an
// action link + user id. The trigger on auth.users creates the profiles row.
async function generateActionLink(email){
  const body = { type:"invite", email, redirect_to: ORIGIN+"/auth-callback.html" };
  let res = await sbFetch("/auth/v1/admin/generate_link", { method:"POST", body:JSON.stringify(body) });
  if(res.status===422 || res.status===409){ // already registered -> magic link
    res = await sbFetch("/auth/v1/admin/generate_link", { method:"POST", body:JSON.stringify({ type:"magiclink", email, redirect_to: ORIGIN+"/auth-callback.html" }) });
  }
  if(!res.ok){ const t=await res.text().catch(()=> ""); throw new Error("generate_link "+res.status+" "+t.slice(0,160)); }
  const j = await res.json();
  const props = j.properties || j;
  const action_link = props.action_link || j.action_link;
  const uid = (j.user && j.user.id) || j.id || j.user_id || null;
  if(!action_link) throw new Error("no action_link in response");
  return { action_link, uid };
}

function emailHtml(link, unsub){
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="X-UA-Compatible" content="IE=edge"></head>'+
  '<body style="margin:0;padding:0;background-color:#f4f6f8;">'+
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f6f8"><tr><td align="center" style="padding:24px 12px;">'+
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #e4e7eb;border-radius:12px;">'+
  '<tr><td style="padding:32px 36px;font-family:Arial,Helvetica,sans-serif;color:#172033;">'+
  '<p style="margin-top:0;margin-bottom:16px;font-size:15px;line-height:1.6;color:#172033;">Hi there,</p>'+
  '<p style="margin-top:0;margin-bottom:16px;font-size:15px;line-height:1.6;color:#172033;">Thanks for confirming! We’ve started your free <strong>Pegasus Capital Network</strong> profile. Click below to log in, review it, and publish — no password needed.</p>'+
  '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:0;margin-bottom:20px;"><tr>'+
  '<td align="center" bgcolor="#3a8fe8" style="background-color:#3a8fe8;border-radius:10px;">'+
  '<a href="'+esc(link)+'" style="display:inline-block;padding-top:13px;padding-bottom:13px;padding-left:26px;padding-right:26px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">Activate &amp; publish my profile</a>'+
  '</td></tr></table>'+
  '<p style="margin-top:0;margin-bottom:0;font-size:13px;line-height:1.5;color:#5b6573;">If the button doesn’t work, this activation link may have expired — just reply and we’ll send a fresh one.</p>'+
  '<p style="margin-top:24px;margin-bottom:0;font-size:15px;line-height:1.6;color:#172033;">— Pegasus Capital Network</p>'+
  '<hr style="border:none;border-top:1px solid #e4e7eb;margin-top:24px;margin-bottom:16px;">'+
  '<p style="margin:0;font-size:11px;line-height:1.5;color:#8a97a8;">'+esc(ADDRESS)+'<br><a href="'+esc(unsub)+'" style="color:#8a97a8;">Unsubscribe</a></p>'+
  '</td></tr></table></td></tr></table></body></html>';
}
function emailText(link, unsub){
  return "Hi there,\n\nThanks for confirming! We’ve started your free Pegasus Capital Network profile. Click to log in, review it, and publish — no password needed:\n\n"+link+"\n\nIf the link has expired, just reply and we’ll send a fresh one.\n\n— Pegasus Capital Network\n"+ADDRESS+"\nUnsubscribe: "+unsub;
}

async function sendEmail(email, link){
  const key = need("RESEND_API_KEY");
  const unsub = ORIGIN+"/unsubscribe?e="+encodeURIComponent(email);
  const res = await fetch("https://api.resend.com/emails", {
    method:"POST",
    headers:{ Authorization:"Bearer "+key, "Content-Type":"application/json" },
    body: JSON.stringify({
      from: FROM, to:[email], reply_to: REPLY_TO,
      subject: "Your Pegasus Capital Network profile is ready — activate it",
      html: emailHtml(link, unsub),
      text: emailText(link, unsub),
      headers: { "List-Unsubscribe": "<"+unsub+">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
    })
  });
  if(!res.ok){ const t=await res.text().catch(()=> ""); throw new Error("resend "+res.status+" "+t.slice(0,160)); }
  return true;
}

exports.handler = async () => {
  const out = { picked:0, provisioned:0, failed:0, errors:[] };
  try{
    const res = await sbFetch("/rest/v1/pn_invite_consent?select=id,email,full_name&status=eq.consented&provisioned_at=is.null&limit="+BATCH, { headers:{ Accept:"application/json" } });
    if(!res.ok){ const t=await res.text().catch(()=> ""); throw new Error("select "+res.status+" "+t.slice(0,160)); }
    const rows = await res.json();
    out.picked = Array.isArray(rows) ? rows.length : 0;
    for(const row of (rows||[])){
      const email = String(row.email||"").trim().toLowerCase();
      if(!email || email.indexOf("@")<0){ out.failed++; continue; }
      try{
        const { action_link, uid } = await generateActionLink(email);
        // Prefill the auto-created profile (best-effort).
        if(uid){
          await sbFetch("/rest/v1/profiles?id=eq."+uid, { method:"PATCH", headers:{ Prefer:"return=minimal" }, body: JSON.stringify({ signup_source:"concierge_invite" }) }).catch(()=>{});
        }
        await sendEmail(email, action_link);
        await sbFetch("/rest/v1/pn_invite_consent?id=eq."+row.id, { method:"PATCH", headers:{ Prefer:"return=minimal" }, body: JSON.stringify({ provisioned_at: new Date().toISOString(), profile_id: uid }) });
        out.provisioned++;
        await sleep(150); // stay under Resend 10 req/s
      }catch(e){ out.failed++; out.errors.push(email.replace(/(^.).*(@.*$)/,"$1***$2")+": "+(e&&e.message||String(e))); }
    }
  }catch(e){ out.errors.push("fatal: "+(e&&e.message||String(e))); }
  console.log("[concierge-build]", JSON.stringify(out));
  return { statusCode: 200, headers:{ "Content-Type":"application/json" }, body: JSON.stringify(out) };
};
