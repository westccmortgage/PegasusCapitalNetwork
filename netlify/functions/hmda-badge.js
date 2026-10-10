// Pegasus — embeddable HMDA 2025 "ranked lender" badge: /badge/:slug.svg
// Ranked companies → "Ranked #N" (or "Top 100 · #N"); unknown slug, unranked
// company or lookup failure → neutral directory badge. Always 200 image/svg+xml.
// Self-contained (Netlify functions do not reliably bundle cross-file imports).

function env(name){return globalThis.Netlify?.env?.get(name)||"";}
function cfg(){
  const url=env("SUPABASE_URL"),key=env("SUPABASE_PUBLISHABLE_KEY");
  if(!url||!key) throw new Error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY");
  return {url:url.replace(/\/$/,""),key};
}
function xml(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");}
function cleanSlug(v){const s=String(v||"").trim();return /^[a-z0-9][a-z0-9-]*$/i.test(s)?s:"";}
function fmtInt(n){const v=Number(n);return Number.isFinite(v)?Math.round(v).toLocaleString("en-US"):"";}
const FONT="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
async function lookup(slug){
  const {url,key}=cfg();
  const qs=new URLSearchParams({select:"name,hmda_rank",slug:"eq."+slug,limit:"1"});
  const res=await fetch(url+"/rest/v1/public_business_directory?"+qs.toString(),{headers:{apikey:key,Authorization:"Bearer "+key,Accept:"application/json"}});
  if(!res.ok) throw new Error("badge lookup failed: "+res.status);
  const rows=await res.json();
  return Array.isArray(rows)&&rows[0]?rows[0]:null;
}
function svg(line1,line2,line3,label){
  return '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="64" viewBox="0 0 300 64" role="img" aria-label="'+xml(label)+'">'+
    '<title>'+xml(label)+'</title>'+
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e3bc63"/><stop offset="1" stop-color="#b8892f"/></linearGradient></defs>'+
    '<rect width="300" height="64" rx="10" fill="#0b1626"/>'+
    '<rect x="0.5" y="0.5" width="299" height="63" rx="9.5" fill="none" stroke="#1f3a5f"/>'+
    '<rect x="10" y="12" width="4" height="40" rx="2" fill="url(#g)"/>'+
    '<rect x="17" y="12" width="2" height="40" rx="1" fill="#3a8fe8"/>'+
    '<g font-family="'+xml(FONT)+'">'+
    '<text x="30" y="27" font-size="17" font-weight="700" fill="#e3bc63">'+xml(line1)+'</text>'+
    '<text x="30" y="44" font-size="12.5" font-weight="600" fill="#f4f8fc">'+xml(line2)+'</text>'+
    '<text x="30" y="57" font-size="9.5" fill="#8fa6c2" letter-spacing=".04em">'+xml(line3)+'</text>'+
    '</g></svg>';
}
function neutral(){
  return svg("Pegasus Capital Network","Member directory","pegasuscapitalnetwork.com","Pegasus Capital Network — Member directory");
}
function reply(body,maxAge){
  return new Response(body,{status:200,headers:{"Content-Type":"image/svg+xml; charset=utf-8","Cache-Control":"public, max-age="+maxAge,"X-Content-Type-Options":"nosniff"}});
}

export default async (request)=>{
  try{
    const u=new URL(request.url);
    // Netlify rewrites pass the ORIGINAL URL: parse /badge/<slug>.svg from the path,
    // falling back to ?slug= for direct function calls.
    const m=u.pathname.match(/^\/badge\/([^\/]+?)(?:\.svg)?\/?$/i);
    let raw=m?m[1]:(u.searchParams.get("slug")||"");
    try{raw=decodeURIComponent(raw);}catch(_){raw="";}
    const slug=cleanSlug(raw);
    if(!slug) return reply(neutral(),86400);
    let row;
    try{row=await lookup(slug);}catch(err){
      console.warn("[hmda-badge]",err&&err.message);
      return reply(neutral(),300); // transient failure: don't pin the neutral badge for a day
    }
    const rank=Number(row&&row.hmda_rank);
    if(!Number.isFinite(rank)||rank<1) return reply(neutral(),86400);
    const r="#"+fmtInt(rank);
    const line1=rank<=100?"Top 100 · "+r:"Ranked "+r;
    return reply(svg(line1,"U.S. Mortgage Lenders 2025","Pegasus Capital Network","Ranked "+r+" U.S. Mortgage Lender 2025 — Pegasus Capital Network"),86400);
  }catch(err){
    console.error("[hmda-badge]",err);
    return reply(neutral(),300);
  }
};
