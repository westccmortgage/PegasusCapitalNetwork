// Pegasus — concierge profile activation (/activate?t=<invite token>).
// The activation email links HERE, not to a raw one-time Supabase magic link:
// mail security scanners open every link on delivery and would burn (and
// "sign in" with) a one-time link before the person ever sees it.
//   GET  → page with an "Activate my profile" button (no side effects)
//   POST → mint a FRESH magic link (service role), flip the concierge profile
//          from 'pending' to 'active', and 303-redirect into the signed-in app.
// The token is the invitee's private capability (same trust as a magic link
// delivered to their mailbox). Valid 30 days after provisioning.

const ORIGIN="https://pegasuscapitalnetwork.com";
const TTL_DAYS=30;
function env(name){return globalThis.Netlify?.env?.get(name)||"";}
function cfg(){
  const url=env("SUPABASE_URL"),key=env("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return {url:url.replace(/\/$/,""),key};
}
function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function cleanToken(v){const s=String(v||"").trim();return /^[A-Za-z0-9_-]{10,128}$/.test(s)?s:"";}
async function sb(path,opts){
  const {url,key}=cfg();
  const h=Object.assign({apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",Accept:"application/json"},(opts&&opts.headers)||{});
  return fetch(url+path,Object.assign({},opts,{headers:h}));
}
function page(title,heading,body,status){
  const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta name="robots" content="noindex,nofollow"><title>'+esc(title)+' — Pegasus Capital Network</title>'+
    '<link rel="icon" href="/assets/brand/favicon.ico">'+
    '<style>body{font-family:Arial,sans-serif;background:#0b1626;color:#f4f8fc;margin:0}.wrap{max-width:560px;margin:0 auto;padding:72px 24px;text-align:center}'+
    '.card{background:#101f36;border:1px solid #22344f;border-radius:18px;padding:40px 32px}h1{font-size:26px;margin:0 0 14px}p{color:#adbdd0;line-height:1.6;font-size:15px;margin:10px 0}'+
    'a.btn,button.btn{display:inline-block;margin-top:18px;background:#3a8fe8;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px;border:0;cursor:pointer;font-size:15px;font-family:inherit}'+
    '.mark{width:46px;height:46px;margin:0 auto 18px;display:block}</style></head><body><div class="wrap"><div class="card">'+
    '<img class="mark" src="/assets/brand/pegasus-symbol.svg" alt="Pegasus">'+
    '<h1>'+esc(heading)+'</h1>'+body+
    '</div><p style="color:#5b6573;font-size:12px;margin-top:22px">Pegasus Capital Network</p></div></body></html>';
  return new Response(html,{status:status||200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow","Referrer-Policy":"no-referrer"}});
}
async function findInvite(token){
  const res=await sb("/rest/v1/pn_invite_consent?select=id,email,full_name,status,profile_id,provisioned_at&token=eq."+encodeURIComponent(token)+"&limit=1");
  if(!res.ok) throw new Error("invite lookup "+res.status);
  const rows=await res.json();
  const r=Array.isArray(rows)&&rows[0];
  if(!r||r.status!=="consented"||!r.provisioned_at||!r.profile_id) return null;
  if(Date.now()-new Date(r.provisioned_at).getTime()>TTL_DAYS*864e5) return {expired:true};
  return r;
}

export default async (request)=>{
  const u=new URL(request.url);
  const token=cleanToken(u.searchParams.get("t"));
  const invalid=()=>page("Link not valid","This activation link isn’t valid",
    '<p>It may be incomplete or already replaced. Reply to your invitation email and we’ll send a fresh one — or sign in if you already activated.</p>'+
    '<a class="btn" href="/signin.html">Sign in</a>',400);
  if(!token) return invalid();
  try{
    const inv=await findInvite(token);
    if(!inv) return invalid();
    if(inv.expired) return page("Link expired","This activation link has expired",
      '<p>For your security, activation links expire after '+TTL_DAYS+' days. Reply to your invitation email and we’ll send a fresh one.</p>',410);
    const first=String(inv.full_name||"").trim().split(/\s+/)[0];
    if(request.method!=="POST"){
      return page("Activate","Welcome"+(first?", "+first:"")+" — activate your profile",
        '<p>Your free Pegasus Capital Network profile is ready for you to review. Activate it to sign in, complete the details, and publish it to the network.</p>'+
        '<form method="post" action="'+esc(u.pathname+u.search)+'" style="margin:0"><button class="btn" type="submit">Activate my profile</button></form>'+
        '<p style="margin-top:18px;font-size:13px">Not interested? <a href="/unsubscribe?t='+esc(token)+'" style="color:#adbdd0">Unsubscribe</a></p>');
    }
    // Human confirmed → fresh magic link + make the profile visible.
    const gl=await sb("/auth/v1/admin/generate_link",{method:"POST",body:JSON.stringify({type:"magiclink",email:inv.email,redirect_to:ORIGIN+"/auth-callback.html"})});
    if(!gl.ok){ const t=await gl.text().catch(()=> ""); throw new Error("generate_link "+gl.status+" "+t.slice(0,160)); }
    const j=await gl.json();
    const link=(j.properties&&j.properties.action_link)||j.action_link;
    if(!link) throw new Error("no action_link");
    await sb("/rest/v1/profiles?id=eq."+encodeURIComponent(inv.profile_id)+"&status=eq.pending",{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:"active",updated_at:new Date().toISOString()})}).catch(()=>{});
    return new Response(null,{status:303,headers:{Location:link,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
  }catch(err){
    console.error("[activate]",err&&err.message);
    return page("Try again","Something went wrong",'<p>Please try again in a moment, or reply to your invitation email and we’ll help.</p>',503);
  }
};
