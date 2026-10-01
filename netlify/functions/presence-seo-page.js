// Pegasus SEO — server-delivered public Business/Event metadata + semantic snapshot.

const ORIGIN="https://pegasuscapitalnetwork.com";
function env(name){return globalThis.Netlify?.env?.get(name)||"";}
function cfg(){
  const url=env("SUPABASE_URL"),key=env("SUPABASE_PUBLISHABLE_KEY");
  if(!url||!key) throw new Error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY");
  return {url:url.replace(/\/$/,""),key};
}
function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function txt(v){return String(v||"").replace(/\s+/g," ").trim();}
function trunc(v,n){const s=txt(v);return s.length<=n?s:s.slice(0,n-1).replace(/\s+\S*$/,"")+"…";}
function safeHttp(v){const s=txt(v);return /^https?:\/\//i.test(s)?s:"";}
function cleanSlug(v){const s=String(v||"").trim();return /^[a-z0-9][a-z0-9-]*$/i.test(s)?s:"";}
function replaceOrInsert(html,regex,replacement,before="</head>"){return regex.test(html)?html.replace(regex,replacement):html.replace(before,replacement+"\n"+before);}
async function getPresence(slug){
  const {url,key}=cfg();
  try{
    const res=await fetch(url+"/rest/v1/rpc/get_presence_page_by_slug",{
      method:"POST",
      headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",Accept:"application/json"},
      body:JSON.stringify({p_slug:slug})
    });
    if(res.ok) return await res.json();
    const body=await res.text().catch(()=> "");
    console.warn("[presence-seo-page] RPC unavailable, using public view:",res.status,body.slice(0,180));
  }catch(err){
    console.warn("[presence-seo-page] RPC threw, using public view:",err&&err.message);
  }

  // Deployment-safe fallback when the latest RPC migration/schema cache is not
  // live yet. public_presence_previews is already the anonymous-safe surface.
  const params=new URLSearchParams({
    select:"id,presence_type,name,slug,tagline,short_description,category,industry,location,market,public_cta_label,public_cta_url,status",
    slug:"eq."+slug,
    limit:"1"
  });
  const fallback=await fetch(url+"/rest/v1/public_presence_previews?"+params.toString(),{
    headers:{apikey:key,Authorization:"Bearer "+key,Accept:"application/json"}
  });
  if(!fallback.ok){
    const body=await fallback.text().catch(()=> "");
    throw new Error("presence fallback failed: "+fallback.status+" "+body.slice(0,300));
  }
  const rows=await fallback.json();
  if(!Array.isArray(rows)||!rows.length) return null;
  return {access:"full",presence:{...rows[0],visibility:"public_preview"},can_manage:false};
}
async function getTemplate(request){
  const u=new URL(request.url);
  const res=await fetch(u.origin+"/presence.html?seo_template=1",{headers:{"User-Agent":"Pegasus-SEO-Renderer/1.0"}});
  if(!res.ok) throw new Error("presence template fetch failed: "+res.status);
  return await res.text();
}
function typeAllowed(kind,type){
  return kind==="event" ? type==="event" : (type==="company" || type==="capital_program");
}
function segment(kind){return kind==="event"?"event":"business";}
function snapshot(p,kind,canonical){
  const name=txt(p.name),tagline=txt(p.tagline),desc=trunc(p.short_description,700);
  const logo=safeHttp(p.logo_url),website=safeHttp(p.website_url);
  const meta=[txt(p.category),txt(p.industry),txt(p.location),txt(p.market)].filter(Boolean);
  const label=kind==="event"?"Event":"Business";
  return '<article id="peg-seo-snapshot" style="max-width:1000px;margin:30px auto 20px;padding:28px 40px;border:1px solid #e4e7eb;border-radius:18px;background:#fff;font-family:Arial,sans-serif;color:#172033">'+
    '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#697386">'+esc(label)+'</div>'+
    '<div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;margin-top:10px">'+
    (logo?'<img src="'+esc(logo)+'" alt="'+esc(name)+' logo" width="96" height="96" style="width:96px;height:96px;border-radius:16px;object-fit:contain;border:1px solid #e4e7eb">':'')+
    '<div style="flex:1;min-width:240px"><h1 style="margin:0 0 8px;font-size:36px;line-height:1.08">'+esc(name)+'</h1>'+
    (tagline?'<p style="font-size:17px;line-height:1.5;margin:8px 0">'+esc(tagline)+'</p>':'')+
    (meta.length?'<div style="color:#5b6573">'+esc(meta.join(" · "))+'</div>':'')+
    '</div></div>'+
    (desc?'<p style="font-size:15px;line-height:1.65;margin:22px 0 0">'+esc(desc)+'</p>':'')+
    (txt(p.offers)?'<section><h2 style="font-size:18px;margin:22px 0 6px">What we offer</h2><p style="line-height:1.6">'+esc(trunc(p.offers,700))+'</p></section>':'')+
    (txt(p.looking_for)?'<section><h2 style="font-size:18px;margin:22px 0 6px">What we are looking for</h2><p style="line-height:1.6">'+esc(trunc(p.looking_for,700))+'</p></section>':'')+
    (website?'<p style="margin:18px 0 0"><a href="'+esc(website)+'">Official website</a></p>':'')+
    '<link rel="canonical" href="'+esc(canonical)+'"></article>';
}
// Server-rendered conversion CTA for business/event pages — converts anonymous
// discovery traffic into signups. Honest + working today (routes to real
// signup/sign-in; no not-yet-built claim flow is promised). Hidden for
// signed-in visitors.
function joinCta(kind){
  var line=kind==="event"
    ? "Host sessions and present who you are inside Pegasus Capital Network. Creating your profile is free."
    : "Represent a company, project, or capital program? Pegasus Capital Network is where professionals present what they do — and get found. Creating your profile is free.";
  return '<aside id="peg-seo-join" style="max-width:1000px;margin:0 auto 34px;padding:22px 32px;border:1px solid #e4e7eb;border-radius:18px;background:#0b1626;color:#f4f8fc;font-family:Arial,sans-serif;display:flex;gap:18px;align-items:center;justify-content:space-between;flex-wrap:wrap">'+
    '<div style="min-width:240px;flex:1"><div style="font-size:18px;font-weight:700;margin-bottom:4px">Be discovered by the right people.</div>'+
    '<div style="font-size:13px;color:#adbdd0;line-height:1.5">'+esc(line)+'</div></div>'+
    '<div style="display:flex;gap:10px;flex-wrap:wrap"><a href="/signup.html" style="background:#3a8fe8;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 18px;border-radius:10px">Create your free profile</a>'+
    '<a href="/signin.html" style="border:1px solid rgba(255,255,255,.3);color:#f4f8fc;text-decoration:none;font-size:14px;padding:11px 18px;border-radius:10px">Sign in</a></div>'+
    '<script>try{if(localStorage.getItem("pegasus.auth")){var e=document.getElementById("peg-seo-join");if(e)e.style.display="none";}}catch(_){}</script></aside>';
}
function render(html,p,kind){
  const slug=cleanSlug(p.slug),seg=segment(kind);
  const canonical=ORIGIN+"/"+seg+"/"+encodeURIComponent(slug);
  const label=kind==="event"?"Event":"Business";
  const rawDesc=txt(p.short_description)||txt(p.tagline)||[txt(p.category),txt(p.industry),txt(p.location),txt(p.market)].filter(Boolean).join(" · ");
  const desc=trunc(rawDesc||(txt(p.name)+" on Pegasus Capital Network"),160);
  const title=txt(p.name)+" — "+label+" | Pegasus Capital Network";
  const image=safeHttp(p.logo_url);

  html=replaceOrInsert(html,/<title>[\s\S]*?<\/title>/i,'<title>'+esc(title)+'</title>');
  html=replaceOrInsert(html,/<link\s+rel=["']canonical["'][^>]*>/i,'<link rel="canonical" href="'+esc(canonical)+'">');
  html=replaceOrInsert(html,/<meta\s+name=["']description["'][^>]*>/i,'<meta name="description" content="'+esc(desc)+'">');
  html=replaceOrInsert(html,/<meta\s+name=["']robots["'][^>]*>/i,'<meta name="robots" content="index,follow,max-image-preview:large">');
  const og=[
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Pegasus Capital Network">',
    '<meta property="og:title" content="'+esc(title)+'">',
    '<meta property="og:description" content="'+esc(desc)+'">',
    '<meta property="og:url" content="'+esc(canonical)+'">',
    image?'<meta property="og:image" content="'+esc(image)+'">':'',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="'+esc(title)+'">',
    '<meta name="twitter:description" content="'+esc(desc)+'">',
    image?'<meta name="twitter:image" content="'+esc(image)+'">':''
  ].filter(Boolean).join("\n");
  let schema;
  if(kind==="event"){
    // The current canonical Event record does not yet have structured start/end
    // dates. Describe it truthfully as a WebPage about an Event without claiming
    // Google Event rich-result eligibility until those fields exist.
    const eventEntity={"@type":"Thing",additionalType:"https://schema.org/Event",name:txt(p.name),url:canonical,description:desc};
    if(txt(p.location)) eventEntity.location=txt(p.location);
    schema={"@context":"https://schema.org","@type":"WebPage",url:canonical,name:title,description:desc,about:eventEntity,mainEntity:eventEntity};
  }else if(p.presence_type==="company"){
    const mainEntity={"@type":"Organization",name:txt(p.name),url:canonical,description:desc};
    if(image) mainEntity.logo=image;
    if(safeHttp(p.website_url)) mainEntity.sameAs=[safeHttp(p.website_url)];
    if(txt(p.location)) mainEntity.location=txt(p.location);
    schema={"@context":"https://schema.org","@type":"ProfilePage",url:canonical,name:title,description:desc,mainEntity};
  }else{
    const mainEntity={"@type":"Service",name:txt(p.name),url:canonical,description:desc};
    schema={"@context":"https://schema.org","@type":"WebPage",url:canonical,name:title,description:desc,about:mainEntity,mainEntity};
  }
  const jsonLd='<script type="application/ld+json">'+JSON.stringify(schema).replace(/</g,"\\u003c")+'</script>';
  html=html.replace("</head>",og+"\n"+jsonLd+"\n</head>");
  html=html.replace("<body>","<body>\n"+snapshot(p,kind,canonical)+"\n"+joinCta(kind));
  return html;
}
function simple(status,title,message){
  return new Response('<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>'+esc(title)+'</title></head><body><main><h1>'+esc(title)+'</h1><p>'+esc(message)+'</p><p><a href="/">Pegasus Capital Network</a></p></main></body></html>',{
    status,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":status===404?"public, max-age=60":"no-store","X-Robots-Tag":"noindex, nofollow"}
  });
}

export default async (request) => {
  const u=new URL(request.url);
  const publicPath=u.pathname.match(/^\/(business|event)\/([^/]+)\/?$/);
  const slug=cleanSlug(publicPath ? publicPath[2] : u.searchParams.get("slug"));
  const kind=publicPath ? publicPath[1] : (u.searchParams.get("kind")==="event"?"event":"business");
  if(!slug) return simple(404,"Page not found","This page does not exist.");
  try{
    const [data,template]=await Promise.all([getPresence(slug),getTemplate(request)]);
    if(!data||data.access==="unavailable") return simple(404,"Page not found","This page is not available.");
    if(data.access!=="full"||!data.presence){
      // Member-only/private public requests stay non-indexable.
      return new Response(template,{status:200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"public, max-age=0, s-maxage=60","X-Robots-Tag":"noindex, nofollow"}});
    }
    const p=data.presence;
    if(!typeAllowed(kind,p.presence_type)) return simple(404,"Page not found","This page does not exist.");
    if(p.visibility!=="public_preview"||p.status!=="active") {
      return new Response(template,{status:200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"public, max-age=0, s-maxage=60","X-Robots-Tag":"noindex, nofollow"}});
    }
    const canonical=ORIGIN+"/"+segment(kind)+"/"+encodeURIComponent(slug);
    return new Response(render(template,p,kind),{
      status:200,
      headers:{
        "Content-Type":"text/html; charset=utf-8",
        "Cache-Control":"public, max-age=0, s-maxage=300, stale-while-revalidate=600",
        "X-Robots-Tag":"index, follow, max-image-preview:large",
        "Link":"<"+canonical+'>; rel="canonical"'
      }
    });
  }catch(err){
    console.error("[presence-seo-page]",err);
    return simple(503,"Page temporarily unavailable","Please try again shortly.");
  }
};
