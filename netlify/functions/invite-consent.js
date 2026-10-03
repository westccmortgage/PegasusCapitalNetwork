// Pegasus — invite consent capture (/yes and /unsubscribe).
// A tokenized link from the invite email. /yes records EXPLICIT consent to build
// a concierge profile; /unsubscribe opts the recipient out. Token = capability.

const ORIGIN="https://pegasuscapitalnetwork.com";
function env(name){return globalThis.Netlify?.env?.get(name)||"";}
function cfg(){
  const url=env("SUPABASE_URL"),key=env("SUPABASE_PUBLISHABLE_KEY");
  if(!url||!key) throw new Error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY");
  return {url:url.replace(/\/$/,""),key};
}
function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function cleanToken(v){const s=String(v||"").trim();return /^[A-Za-z0-9_-]{10,128}$/.test(s)?s:"";}
async function rpc(fn,token){
  const {url,key}=cfg();
  const res=await fetch(url+"/rest/v1/rpc/"+fn,{
    method:"POST",
    headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",Accept:"application/json"},
    body:JSON.stringify({p_token:token})
  });
  if(!res.ok) return {ok:false};
  try{return await res.json();}catch(_){return {ok:false};}
}
function page(title,heading,body){
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta name="robots" content="noindex,nofollow"><title>'+esc(title)+' — Pegasus Capital Network</title>'+
    '<link rel="stylesheet" href="/css/pegasus.css"><link rel="icon" href="/assets/brand/favicon.ico">'+
    '<style>body{font-family:Arial,sans-serif;background:#0b1626;color:#f4f8fc;margin:0}.wrap{max-width:560px;margin:0 auto;padding:72px 24px;text-align:center}'+
    '.card{background:#101f36;border:1px solid #22344f;border-radius:18px;padding:40px 32px}h1{font-size:26px;margin:0 0 14px}p{color:#adbdd0;line-height:1.6;font-size:15px;margin:10px 0}'+
    'a.btn{display:inline-block;margin-top:18px;background:#3a8fe8;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px}'+
    '.mark{width:46px;height:46px;margin:0 auto 18px;display:block}</style></head><body><div class="wrap"><div class="card">'+
    '<img class="mark" src="/assets/brand/pegasus-symbol.svg" alt="Pegasus">'+
    '<h1>'+esc(heading)+'</h1>'+body+
    '</div><p style="color:#5b6573;font-size:12px;margin-top:22px">Pegasus Capital Network</p></div></body></html>';
}
function resp(html,status){return new Response(html,{status:status||200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow"}});}

export default async (request)=>{
  const u=new URL(request.url);
  const isOptOut=/\/(unsubscribe|no)\b/.test(u.pathname) || u.searchParams.get("action")==="unsubscribe";
  const token=cleanToken(u.searchParams.get("t")||u.searchParams.get("token"));
  if(!token){
    return resp(page("Link not valid","This link isn’t valid",
      '<p>The link may be incomplete. Please use the button from your invitation email, or just create your profile directly.</p>'+
      '<a class="btn" href="/signup.html">Create my free profile</a>'),400);
  }
  try{
    if(isOptOut){
      await rpc("record_invite_optout",token);
      return resp(page("Unsubscribed","You’re unsubscribed",
        '<p>You won’t receive further invitations from Pegasus Capital Network. No profile will be created for you.</p>'));
    }
    const r=await rpc("record_invite_consent",token);
    if(!r||r.ok!==true){
      return resp(page("Link not valid","We couldn’t confirm that link",
        '<p>The link may have expired or already been used. You can still create your profile directly — it only takes two minutes.</p>'+
        '<a class="btn" href="/signup.html">Create my free profile</a>'));
    }
    const name=String(r.name||"").trim();
    return resp(page("Thanks","Thanks"+(name?", "+esc(name.split(/\s+/)[0]):"")+"!",
      '<p>We’re setting up your free Pegasus Capital Network profile. You’ll get an email with a link to review, complete, and publish it — nothing goes live until you confirm.</p>'+
      '<p>Prefer to do it now?</p>'+
      '<a class="btn" href="/signup.html">Set it up myself</a>'));
  }catch(err){
    console.error("[invite-consent]",err);
    return resp(page("Try again","Something went wrong",
      '<p>Please try the link again shortly, or create your profile directly.</p>'+
      '<a class="btn" href="/signup.html">Create my free profile</a>'),503);
  }
};
