// Pegasus — Resend delivery events → invitation queue.
// Resend POSTs email.delivered / email.bounced / email.complained /
// email.delivery_delayed / email.failed here (webhook configured in Resend).
// Verified with the webhook signing secret (Svix scheme); without a valid
// signature nothing is written. Matches pn_invite_consent.resend_id:
//   delivered            → delivery_status='delivered'
//   bounced / complained → delivery_status=<event>, status='opted_out' (never
//                          contacted again; feeds the outreach auto-pause)
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_WEBHOOK_SECRET (whsec_…)
import crypto from "node:crypto";

function env(name){return globalThis.Netlify?.env?.get(name)||"";}
const TOLERANCE_S = 5*60;

function verify(secret, id, ts, body, sigHeader){
  if(!secret || !id || !ts || !sigHeader) return false;
  const age = Math.abs(Date.now()/1000 - Number(ts));
  if(!Number.isFinite(age) || age > TOLERANCE_S) return false;
  const key = Buffer.from(secret.replace(/^whsec_/,""), "base64");
  const expected = crypto.createHmac("sha256", key).update(id+"."+ts+"."+body).digest();
  // Header: space-separated "v1,<base64>" entries (several during key rotation).
  return sigHeader.split(" ").some(part=>{
    const [ver, sig] = part.split(",");
    if(ver!=="v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length===expected.length && crypto.timingSafeEqual(got, expected);
  });
}
async function patchByResendId(resendId, patch){
  const url = env("SUPABASE_URL").replace(/\/$/,""), key = env("SUPABASE_SERVICE_ROLE_KEY");
  if(!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(url+"/rest/v1/pn_invite_consent?resend_id=eq."+encodeURIComponent(resendId), {
    method:"PATCH",
    headers:{ apikey:key, Authorization:"Bearer "+key, "Content-Type":"application/json", Prefer:"return=minimal" },
    body: JSON.stringify(patch)
  });
  if(!res.ok){ const t=await res.text().catch(()=> ""); throw new Error("patch "+res.status+" "+t.slice(0,160)); }
}

export default async (request)=>{
  if(request.method!=="POST") return new Response("Method not allowed",{status:405});
  const body = await request.text();
  const h = request.headers;
  const secret = String(env("RESEND_WEBHOOK_SECRET")||"").trim();
  const id = h.get("svix-id")||h.get("webhook-id");
  const ts = h.get("svix-timestamp")||h.get("webhook-timestamp");
  const sig = h.get("svix-signature")||h.get("webhook-signature")||"";
  // Distinct, non-secret reasons so delivery logs show what to fix.
  if(!secret) return new Response("webhook secret not configured",{status:503});
  if(!/^whsec_[A-Za-z0-9+/=]+$/.test(secret)) return new Response("webhook secret malformed",{status:503});
  if(!id || !ts || !sig) return new Response("missing signature headers",{status:400});
  if(!verify(secret, id, ts, body, sig)) return new Response("invalid signature",{status:401});
  let evt; try{ evt = JSON.parse(body); }catch(_){ return new Response("bad json",{status:400}); }
  const type = String(evt && evt.type || "");
  const emailId = evt && evt.data && (evt.data.email_id || evt.data.id);
  if(!emailId) return new Response("ignored",{status:200});
  const now = new Date().toISOString();
  try{
    if(type==="email.delivered"){
      await patchByResendId(emailId, { delivery_status:"delivered", delivery_checked_at:now });
    }else if(type==="email.bounced" || type==="email.complained"){
      const ds = type==="email.bounced" ? "bounced" : "complained";
      await patchByResendId(emailId, { delivery_status:ds, delivery_checked_at:now, status:"opted_out", opted_out_at:now });
    }else if(type==="email.delivery_delayed" || type==="email.failed"){
      await patchByResendId(emailId, { delivery_status:type.replace("email.",""), delivery_checked_at:now });
    }
  }catch(err){
    console.error("[resend-webhook]", err && err.message);
    return new Response("retry",{status:500}); // Resend retries on non-2xx
  }
  return new Response("ok",{status:200});
};
