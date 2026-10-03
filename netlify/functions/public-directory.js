// Pegasus SEO — public, crawlable People / Businesses / Events directories.
// Businesses are organized into capital-stack SECTIONS (Capital & Lenders,
// Advisors & Brokers, Real Estate, Transaction & Services) with category chips
// and dedicated landing pages (/businesses/<section>[/<category>]) for SEO.

const ORIGIN="https://pegasuscapitalnetwork.com";
const PAGE_SIZE=48;
function env(name){return globalThis.Netlify?.env?.get(name)||"";}
function cfg(){
  const url=env("SUPABASE_URL"),key=env("SUPABASE_PUBLISHABLE_KEY");
  if(!url||!key) throw new Error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY");
  return {url:url.replace(/\/$/,""),key};
}
function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function txt(v){return String(v||"").replace(/\s+/g," ").trim();}
function role(v){return txt(v).replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());}
function pageNum(v){const n=parseInt(v||"1",10);return Number.isFinite(n)&&n>0?Math.min(n,1000):1;}
function cleanSlug(v){const s=String(v||"").trim();return /^[a-z0-9][a-z0-9-]*$/i.test(s)?s:"";}
function parseTotal(cr){const m=String(cr||"").match(/\/(\d+)$/);return m?parseInt(m[1],10):null;}
async function fetchRows(path,params,page){
  const {url,key}=cfg();
  const offset=(page-1)*PAGE_SIZE;
  const qs=new URLSearchParams(params);
  const res=await fetch(url+"/rest/v1/"+path+"?"+qs.toString(),{
    headers:{apikey:key,Authorization:"Bearer "+key,Range:offset+"-"+(offset+PAGE_SIZE-1),"Range-Unit":"items",Prefer:"count=exact"}
  });
  if(res.status===416) return {rows:[],total:parseTotal(res.headers.get("content-range"))};
  if(!res.ok){const body=await res.text().catch(()=> "");throw new Error(path+" directory query failed: "+res.status+" "+body.slice(0,300));}
  return {rows:await res.json(),total:parseTotal(res.headers.get("content-range"))};
}
// Facet counts (small table) drive the section tabs + category chips.
async function loadFacets(){
  try{
    const {url,key}=cfg();
    const qs=new URLSearchParams({select:"section_slug,section_label,section_sort,cat_slug,cat_label,cat_sort,n",order:"section_sort.asc,cat_sort.asc"});
    const res=await fetch(url+"/rest/v1/public_business_facets?"+qs.toString(),{
      headers:{apikey:key,Authorization:"Bearer "+key,Range:"0-499","Range-Unit":"items"}
    });
    if(!res.ok) return [];
    const rows=await res.json();
    return Array.isArray(rows)?rows:[];
  }catch(_){return [];}
}
// Build an ordered section model from the flat facet rows.
function buildSections(facets){
  const map=new Map();
  for(const f of facets){
    const ss=cleanSlug(f.section_slug)||"other";
    if(!map.has(ss)) map.set(ss,{slug:ss,label:txt(f.section_label)||"Other",sort:f.section_sort??99,total:0,cats:[]});
    const s=map.get(ss);
    const cs=cleanSlug(f.cat_slug)||"other";
    s.cats.push({slug:cs,label:txt(f.cat_label)||"Other",sort:f.cat_sort??99,n:f.n||0});
    s.total+=(f.n||0);
  }
  const sections=[...map.values()].sort((a,b)=>a.sort-b.sort||a.label.localeCompare(b.label));
  for(const s of sections) s.cats.sort((a,b)=>a.sort-b.sort||a.label.localeCompare(b.label));
  return sections;
}
async function load(kind,page,section,category){
  if(kind==="people"){
    return fetchRows("profiles",{
      select:"profile_slug,full_name,role,professional_title,company_name,location,avatar_url,headline,updated_at",
      profile_slug:"not.is.null",full_name:"not.is.null",order:"updated_at.desc"
    },page);
  }
  if(kind==="businesses"){
    const params={
      select:"presence_type,name,slug,tagline,short_description,category,industry,location,market,status,section_slug,cat_slug",
      order:"name.asc"
    };
    if(section&&section!=="all") params.section_slug="eq."+section;
    if(category) params.cat_slug="eq."+category;
    try{
      return await fetchRows("public_business_directory",params,page);
    }catch(err){
      // Deployment-safe fallback if the taxonomy view/migration is not live yet:
      // serve the flat business list (no sections) rather than erroring.
      console.warn("[public-directory] taxonomy view unavailable, flat fallback:",err&&err.message);
      return await fetchRows("public_presence_previews",{
        select:"presence_type,name,slug,tagline,short_description,category,industry,location,market,status",
        presence_type:"eq.company",status:"eq.active",order:"name.asc"
      },page);
    }
  }
  // events
  return fetchRows("public_presence_previews",{
    select:"presence_type,name,slug,tagline,short_description,category,industry,location,market,status",
    presence_type:"eq.event",status:"eq.active",order:"name.asc"
  },page);
}
function card(item,kind){
  if(kind==="people"){
    const slug=encodeURIComponent(item.profile_slug||"");
    const meta=[txt(item.professional_title)||role(item.role),txt(item.company_name),txt(item.location)].filter(Boolean).join(" · ");
    const av=txt(item.avatar_url);
    return '<article class="dir-card"><a class="dir-link" href="/u/'+slug+'">'+
      (av?'<img class="dir-avatar" src="'+esc(av)+'" alt="'+esc(item.full_name||"")+'" loading="lazy" width="68" height="68">':'<div class="dir-avatar dir-initial">'+esc((txt(item.full_name)[0]||"P").toUpperCase())+'</div>')+
      '<div><h2>'+esc(item.full_name||"Pegasus Member")+'</h2>'+(meta?'<p class="dir-meta">'+esc(meta)+'</p>':'')+
      (txt(item.headline)?'<p class="dir-desc">'+esc(txt(item.headline))+'</p>':'')+
      '<span class="dir-open">View profile →</span></div></a></article>';
  }
  const seg=kind==="events"?"event":"business";
  const meta=[txt(item.category),txt(item.industry),txt(item.location),txt(item.market)].filter(Boolean).join(" · ");
  const desc=txt(item.tagline)||txt(item.short_description);
  return '<article class="dir-card"><a class="dir-link" href="/'+seg+'/'+encodeURIComponent(item.slug||"")+'">'+
    '<div class="dir-avatar dir-initial">'+esc((txt(item.name)[0]||"P").toUpperCase())+'</div>'+
    '<div><h2>'+esc(item.name||"Pegasus "+(kind==="events"?"Event":"Business"))+'</h2>'+(meta?'<p class="dir-meta">'+esc(meta)+'</p>':'')+
    (desc?'<p class="dir-desc">'+esc(desc)+'</p>':'')+'<span class="dir-open">View '+(kind==="events"?"event":"business")+' →</span></div></a></article>';
}
function bizPath(section,category){
  let p="/businesses";
  if(section&&section!=="all"){p+="/"+section;if(category)p+="/"+category;}
  return p;
}
// Section tabs + (within an active section) category chips.
function businessNav(sections,activeSection,activeCategory){
  if(!sections.length) return "";
  const grand=sections.reduce((a,s)=>a+s.total,0);
  let secRow='<div class="biz-sections"><a href="/businesses" class="'+(activeSection==="all"?"on":"")+'">All <span>'+grand+'</span></a>';
  for(const s of sections){
    secRow+='<a href="'+esc(bizPath(s.slug))+'" class="'+(activeSection===s.slug?"on":"")+'">'+esc(s.label)+' <span>'+s.total+'</span></a>';
  }
  secRow+='</div>';
  let catRow="";
  if(activeSection!=="all"){
    const sec=sections.find(s=>s.slug===activeSection);
    if(sec&&sec.cats.length){
      catRow='<div class="biz-cats"><a href="'+esc(bizPath(sec.slug))+'" class="'+(!activeCategory?"on":"")+'">All '+esc(sec.label)+'</a>';
      for(const c of sec.cats){
        catRow+='<a href="'+esc(bizPath(sec.slug,c.slug))+'" class="'+(activeCategory===c.slug?"on":"")+'">'+esc(c.label)+' <span>'+c.n+'</span></a>';
      }
      catRow+='</div>';
    }
  }
  return secRow+catRow;
}
function render(ctx){
  const {kind,page,rows,total,sections=[],activeSection="all",activeCategory=null}=ctx;
  const label=kind==="people"?"People":kind==="events"?"Events":"Businesses";
  const singular=kind==="people"?"professionals":kind==="events"?"capital and industry events":"companies";

  // Resolve active section/category labels for business headings + SEO.
  let secObj=null,catObj=null;
  if(kind==="businesses"&&activeSection!=="all"){
    secObj=sections.find(s=>s.slug===activeSection)||null;
    if(secObj&&activeCategory) catObj=secObj.cats.find(c=>c.slug===activeCategory)||null;
  }
  const path=kind==="businesses"?bizPath(activeSection,activeCategory):("/"+kind);
  const canonical=ORIGIN+path+(page>1?"?page="+page:"");

  const headingBase=catObj?catObj.label:secObj?secObj.label:label;
  const h1=kind==="businesses"&&(secObj||catObj)?headingBase:label;
  const title=(catObj?catObj.label+" — Businesses":secObj?secObj.label+" — Businesses":label)+" — Pegasus Capital Network"+(page>1?" | Page "+page:"");
  const desc=kind==="businesses"
    ? (catObj?"Browse "+catObj.label.toLowerCase()+" on Pegasus Capital Network — claimable company pages across private capital, lending, real estate and investment."
       :secObj?"Browse "+secObj.label.toLowerCase()+" on Pegasus Capital Network — companies across private capital, lending, real estate and investment."
       :"Discover companies on Pegasus Capital Network — lenders, private capital, brokers, real estate and transaction services. Public, claimable business pages.")
    : "Discover "+singular+" on Pegasus Capital Network. Public profiles connect people, businesses and events across private capital, lending, real estate and investment.";

  const pages=total==null?null:Math.max(1,Math.ceil(total/PAGE_SIZE));
  const hasPrev=page>1,hasNext=pages? page<pages : rows.length===PAGE_SIZE;
  const pagerBase=path;
  const itemList={"@context":"https://schema.org","@type":"ItemList","name":title,"itemListElement":rows.map((x,i)=>({
    "@type":"ListItem",position:(page-1)*PAGE_SIZE+i+1,
    url:ORIGIN+(kind==="people"?"/u/"+encodeURIComponent(x.profile_slug||""):kind==="events"?"/event/"+encodeURIComponent(x.slug||""):"/business/"+encodeURIComponent(x.slug||""))
  }))};

  const subnav=kind==="businesses"?businessNav(sections,activeSection,activeCategory):"";
  const emptyMsg=kind==="businesses"&&(secObj||catObj)
    ? 'No companies are listed in this category yet.'
    : 'No public '+label.toLowerCase()+' are listed yet.';

  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+esc(title)+'</title><meta name="description" content="'+esc(desc)+'"><meta name="robots" content="index,follow,max-image-preview:large">'+
    '<link rel="canonical" href="'+esc(canonical)+'">'+
    (hasPrev?'<link rel="prev" href="'+esc(ORIGIN+pagerBase+(page===2?"":"?page="+(page-1)))+'">':'')+
    (hasNext?'<link rel="next" href="'+esc(ORIGIN+pagerBase+"?page="+(page+1))+'">':'')+
    '<link rel="stylesheet" href="/css/pegasus.css"><link rel="icon" href="/assets/brand/favicon.ico">'+
    '<script type="application/ld+json">'+JSON.stringify(itemList).replace(/</g,"\\u003c")+'</script>'+
    '<style>.dir-wrap{max-width:1120px;margin:auto;padding:48px 40px 72px}.dir-head{text-align:center;max-width:760px;margin:0 auto 20px}.dir-head h1{font-family:var(--serif);font-size:clamp(34px,5vw,54px);font-weight:400;margin:8px 0 12px}.dir-head p{color:var(--text2);line-height:1.65}.dir-tabs{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin:22px 0 0}.dir-tabs a{padding:8px 14px;border:1px solid var(--border);border-radius:999px;text-decoration:none;color:var(--text2);font-size:12px}.dir-tabs a.on{background:var(--text);color:var(--bg);border-color:var(--text)}'+
    '.biz-sections{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin:18px auto 0;max-width:960px}.biz-sections a{padding:8px 14px;border:1px solid var(--border);border-radius:10px;text-decoration:none;color:var(--text2);font-size:12.5px;font-weight:600}.biz-sections a span{color:var(--text3);font-weight:400}.biz-sections a.on{background:var(--blue);color:#fff;border-color:var(--blue)}.biz-sections a.on span{color:rgba(255,255,255,.75)}'+
    '.biz-cats{display:flex;justify-content:center;gap:7px;flex-wrap:wrap;margin:12px auto 0;max-width:960px}.biz-cats a{padding:6px 12px;border:1px solid var(--border);border-radius:999px;text-decoration:none;color:var(--text2);font-size:11.5px}.biz-cats a span{color:var(--text3)}.biz-cats a.on{background:var(--text);color:var(--bg);border-color:var(--text)}.biz-cats a.on span{color:rgba(255,255,255,.7)}'+
    '.dir-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:26px}.dir-card{background:var(--bg1);border:1px solid var(--border);border-radius:16px;box-shadow:var(--sh-card)}.dir-link{display:flex;gap:16px;padding:20px;text-decoration:none}.dir-avatar{width:68px;height:68px;border-radius:50%;object-fit:cover;flex:none}.dir-initial{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#17315A,#0E1E36);color:#fff;font-family:var(--serif);font-size:28px}.dir-card h2{font-size:16px;margin:2px 0 5px;color:var(--text)}.dir-meta{font-size:12px;color:var(--text3);margin:0}.dir-desc{font-size:12.5px;line-height:1.5;color:var(--text2);margin:8px 0 0}.dir-open{display:inline-block;margin-top:10px;font-size:11.5px;color:var(--blue)}.dir-pager{display:flex;justify-content:center;gap:10px;margin-top:30px}.dir-pager a{padding:9px 14px;border:1px solid var(--border);border-radius:9px;text-decoration:none;color:var(--text2)}.dir-empty{text-align:center;padding:50px;color:var(--text3)}@media(max-width:760px){.dir-wrap{padding:32px 20px 54px}.dir-grid{grid-template-columns:1fr}}</style></head><body>'+
    '<nav class="pub-nav"><a class="brand" href="/"><img class="brand-mark" src="/assets/brand/pegasus-symbol.svg" alt="Pegasus"><span>Pegasus Network</span></a><div class="pub-links"><a href="/people">People</a><a href="/businesses">Businesses</a><a href="/events">Events</a><a href="/explore.html">Explore</a></div><div class="nav-cta"><a class="btn btn-ghost" href="/signin.html">Sign In</a><a class="btn btn-pri" href="/signup.html">Create Free Profile</a></div></nav>'+
    '<main class="dir-wrap"><header class="dir-head"><div class="eyebrow" style="justify-content:center">Public Network</div><h1>'+esc(h1)+'</h1><p>'+esc(desc)+'</p><div class="dir-tabs">'+
    '<a href="/people" class="'+(kind==="people"?"on":"")+'">People</a><a href="/businesses" class="'+(kind==="businesses"?"on":"")+'">Businesses</a><a href="/events" class="'+(kind==="events"?"on":"")+'">Events</a></div>'+subnav+'</header>'+
    (rows.length?'<section class="dir-grid">'+rows.map(x=>card(x,kind)).join("")+'</section>':'<div class="dir-empty">'+esc(emptyMsg)+'</div>')+
    '<nav class="dir-pager" aria-label="Pagination">'+(hasPrev?'<a href="'+esc(pagerBase+(page===2?"":"?page="+(page-1)))+'">← Previous</a>':'')+(hasNext?'<a href="'+esc(pagerBase+"?page="+(page+1))+'">Next →</a>':'')+'</nav></main>'+
    '<footer style="text-align:center;padding:28px;color:var(--text3);border-top:1px solid var(--border)"><a href="/" style="color:inherit">Pegasus Capital Network</a> · Public professional discovery network</footer></body></html>';
}
function errPage(status,title){
  return new Response('<!doctype html><html><head><meta name="robots" content="noindex,nofollow"><title>'+esc(title)+'</title></head><body><h1>'+esc(title)+'</h1><a href="/">Pegasus Capital Network</a></body></html>',{status,headers:{"Content-Type":"text/html; charset=utf-8","X-Robots-Tag":"noindex,nofollow","Cache-Control":"no-store"}});
}

export default async (request)=>{
  const u=new URL(request.url);
  const publicPath=u.pathname.match(/^\/(people|businesses|events)\/?$/);
  const requested=publicPath ? publicPath[1] : u.searchParams.get("kind");
  const kind=requested==="businesses"?"businesses":requested==="events"?"events":"people";
  const page=pageNum(u.searchParams.get("page"));
  try{
    if(kind==="businesses"){
      const facets=await loadFacets();
      const sections=buildSections(facets);
      let activeSection=cleanSlug(u.searchParams.get("section"))||"all";
      let activeCategory=cleanSlug(u.searchParams.get("category"))||null;
      // Validate against real facets; unknown section/category falls back cleanly.
      if(activeSection!=="all" && !sections.some(s=>s.slug===activeSection)){activeSection="all";activeCategory=null;}
      if(activeCategory){
        const sec=sections.find(s=>s.slug===activeSection);
        if(!sec||!sec.cats.some(c=>c.slug===activeCategory)) activeCategory=null;
      }
      const {rows,total}=await load(kind,page,activeSection,activeCategory);
      if(page>1&&!rows.length) return errPage(404,"Directory page not found");
      return new Response(render({kind,page,rows,total,sections,activeSection,activeCategory}),{status:200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"public, max-age=0, s-maxage=300, stale-while-revalidate=600","Netlify-Vary":"query=page|section|category","X-Robots-Tag":"index,follow,max-image-preview:large"}});
    }
    const {rows,total}=await load(kind,page);
    if(page>1&&!rows.length) return errPage(404,"Directory page not found");
    return new Response(render({kind,page,rows,total}),{status:200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"public, max-age=0, s-maxage=300, stale-while-revalidate=600","Netlify-Vary":"query=page","X-Robots-Tag":"index,follow,max-image-preview:large"}});
  }catch(err){
    console.error("[public-directory]",err);
    return errPage(503,"Directory temporarily unavailable");
  }
};
