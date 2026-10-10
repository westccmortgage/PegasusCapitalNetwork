// ============================================================================
// PEGASUS NETWORK — Member referral invitations (scheduled, every 15 min)
// netlify/functions/referral-sender.js
//
// Sends the invitations members queue via invite_colleagues() (pn_invite_consent
// source 'member_referral'): one plain-text email per invitee, naming the
// member who invited them and quoting their note. The consent link is the
// POST-confirmed /yes?t= (scanner-proof); concierge-build then builds the
// profile. Respects the global outreach pause (a bounce/complaint spike stops
// referrals too). Server-side only — service_role + Resend REST.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PEGASUS_RESEND_API_KEY
// ============================================================================
"use strict";

const ORIGIN = "https://pegasuscapitalnetwork.com";
const FROM = "Pegasus Capital Network <invites@pegasuscapitalnetwork.com>";
const REPLY_TO = "info@pegasuscapitalnetwork.com";
const ADDRESS = "Pegasus Capital Network · 150 E Olive Ave, Unit 112, Burbank, CA 91502";
const BATCH = 10;

function need(name){ const v = process.env[name]; if(!v) throw new Error("Missing env "+name); return v; }
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
async function sb(path, opts){
  const url = need("SUPABASE_URL").replace(/\/$/,""), key = need("SUPABASE_SERVICE_ROLE_KEY");
  const h = Object.assign({ apikey:key, Authorization:"Bearer "+key, "Content-Type":"application/json", Accept:"application/json" }, (opts&&opts.headers)||{});
  const res = await fetch(url+path, Object.assign({}, opts, { headers:h }));
  if(!res.ok){ const t=await res.text().catch(()=> ""); throw new Error(path.split("?")[0]+" "+res.status+" "+t.slice(0,160)); }
  if(res.status===204) return null;
  const txt = await res.text(); return txt ? JSON.parse(txt) : null;
}
function resendKey(){ const k = process.env.PEGASUS_RESEND_API_KEY || process.env.RESEND_API_KEY; if(!k) throw new Error("Missing PEGASUS_RESEND_API_KEY"); return k; }
function clean(s, n){ return String(s||"").replace(/[\r\n\t]+/g," ").replace(/\s{2,}/g," ").trim().slice(0, n||200); }

function buildEmail(r){
  const m = r.metadata||{};
  const inviter = clean(m.inviter_name, 120) || "A member";
  const role = [clean(m.inviter_title, 120), clean(m.inviter_company, 120)].filter(Boolean).join(", ");
  const first = clean(r.full_name, 120).split(" ")[0];
  const note = clean(m.note, 300);
  const yes = ORIGIN+"/yes?t="+r.token;
  const signup = ORIGIN+"/signup.html"+(m.inviter_slug ? "?ref="+encodeURIComponent(m.inviter_slug) : "");
  const unsub = ORIGIN+"/unsubscribe?t="+r.token;
  const subject = inviter+" invited you to Pegasus Capital Network";
  const text =
    "Hi "+(first||"there")+",\n\n"+
    inviter+(role?" ("+role+")":"")+" invited you to join Pegasus Capital Network (pegasuscapitalnetwork.com), a professional network for real estate developers, lenders, brokers, and capital partners.\n\n"+
    (note ? inviter.split(" ")[0]+" wrote: “"+note+"”\n\n" : "")+
    "Accept the invitation and we'll set up your free profile — you'll get a private link to review it before anything goes live:\n"+yes+"\n\n"+
    "Prefer to set it up yourself? "+signup+"\n\n"+
    "— Pegasus Capital Network\n\n"+
    "You received this because "+inviter+" entered your address to invite you. We won't email you again unless you accept.\n"+ADDRESS+"\nUnsubscribe: "+unsub;
  return { subject, text, unsub };
}

exports.handler = async () => {
  const out = { picked:0, sent:0, failed:0, reason:null, errors:[] };
  try{
    const st = await sb("/rest/v1/pn_settings?select=value&key=eq.outreach_global&limit=1");
    const s = st && st[0] && st[0].value;
    if(s && s.paused){ out.reason = "paused: "+(s.paused_reason||"manual"); return done(out); }
    const rows = await sb("/rest/v1/pn_invite_consent?select=id,token,email,full_name,metadata&source=eq.member_referral&status=eq.invited&last_sent_at=is.null&order=created_at.asc&limit="+BATCH);
    out.picked = (rows||[]).length;
    for(const r of (rows||[])){
      try{
        const { subject, text, unsub } = buildEmail(r);
        const res = await fetch("https://api.resend.com/emails", {
          method:"POST",
          headers:{ Authorization:"Bearer "+resendKey(), "Content-Type":"application/json", "Idempotency-Key":"referral-"+r.id },
          body: JSON.stringify({ from:FROM, to:[r.email], reply_to:REPLY_TO, subject, text,
            headers:{ "List-Unsubscribe":"<"+unsub+">", "List-Unsubscribe-Post":"List-Unsubscribe=One-Click" },
            tags:[{ name:"campaign", value:"member_referral" }] })
        });
        if(!res.ok){ const t=await res.text().catch(()=> ""); throw new Error("resend "+res.status+" "+t.slice(0,160)); }
        const j = await res.json();
        await sb("/rest/v1/pn_invite_consent?id=eq."+r.id, { method:"PATCH", headers:{ Prefer:"return=minimal" },
          body: JSON.stringify({ last_sent_at:new Date().toISOString(), send_count:1, resend_id:j.id||null, delivery_status:"sent" }) });
        out.sent++;
      }catch(e){
        out.failed++; out.errors.push(String(r.email).replace(/(^.).*(@.*$)/,"$1***$2")+": "+(e&&e.message||String(e)));
        const msg = String(e&&e.message);
        if(/resend (429|401|403)/.test(msg)) break;
        if(/resend 422/.test(msg)){
          await sb("/rest/v1/pn_invite_consent?id=eq."+r.id, { method:"PATCH", headers:{ Prefer:"return=minimal" },
            body: JSON.stringify({ last_sent_at:new Date().toISOString(), delivery_status:"rejected" }) }).catch(()=>{});
        }
      }
      await sleep(200);
    }
  }catch(e){ out.errors.push("fatal: "+(e&&e.message||String(e))); }
  return done(out);
};
exports._buildEmail = buildEmail; // local template checks only
function done(out){
  console.log("[referral-sender]", JSON.stringify(out));
  return { statusCode:200, headers:{ "Content-Type":"application/json" }, body: JSON.stringify(out) };
}
