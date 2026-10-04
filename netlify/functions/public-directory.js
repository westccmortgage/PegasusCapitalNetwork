// Pegasus SEO — public, crawlable People / Businesses / Events directories.
// Businesses AND People are organized into capital-stack SECTIONS with sub
// (category / role) chips and dedicated landing pages for SEO. People are REAL,
// consented members only — grouped by their own public fields, never fabricated.

const ORIGIN="https://pegasuscapitalnetwork.com";

// ── People taxonomy (inlined; Netlify functions do not reliably bundle a
//    cross-file ESM import, so keep each function self-contained). ──
const PERSON_SECTIONS = [
  { slug:"lenders",    label:"Lenders & Loan Officers" },
  { slug:"advisors",   label:"Brokers & Advisors" },
  { slug:"realestate", label:"Real Estate" },
  { slug:"investors",  label:"Investors & Capital" },
  { slug:"services",   label:"Services & Operators" },
  { slug:"other",      label:"Other" },
];
const PERSON_ROLES = [
  { slug:"loan-officers",       label:"Loan Officers",                 section:"lenders",    match:["loan officer","loan originator","mlo","mortgage loan originator"] },
  { slug:"real-estate-agents",  label:"Real Estate Agents & Brokers",  section:"realestate", match:["real estate agent","realtor","real estate broker","real estate salesperson"] },
  { slug:"mortgage-brokers",    label:"Mortgage Brokers",              section:"advisors",   match:["mortgage broker","broker"] },
  { slug:"developers",          label:"Developers",                    section:"realestate", match:["real estate developer","developer","homebuilder","builder"] },
  { slug:"property-managers",   label:"Property Managers",             section:"realestate", match:["property manager","property management"] },
  { slug:"private-lenders",     label:"Private & Hard Money Lenders",  section:"lenders",    match:["private lender","hard money","bridge lender"] },
  { slug:"financial-advisors",  label:"Financial Advisors & Planners", section:"advisors",   match:["financial advisor","financial planner","wealth manager","wealth advisor","wealth management","financial advisory"] },
  { slug:"capital-advisors",    label:"Capital Advisors",              section:"advisors",   match:["capital strategist","capital advisor","capital placement","investment banker","capital markets"] },
  { slug:"fund-managers",       label:"Fund Managers",                 section:"investors",  match:["fund manager","general partner","portfolio manager"] },
  { slug:"family-offices",      label:"Family Offices",                section:"investors",  match:["family office"] },
  { slug:"investors",           label:"Investors & LPs",               section:"investors",  match:["investor","limited partner","syndicator","syndication"] },
  { slug:"appraisers",          label:"Appraisers",                    section:"services",   match:["appraiser","appraisal"] },
  { slug:"attorneys",           label:"Attorneys",                     section:"services",   match:["attorney","lawyer","legal counsel"] },
  { slug:"accountants",         label:"Accountants & CPAs",            section:"services",   match:["cpa","accountant","accounting"] },
  { slug:"title-escrow",        label:"Title & Escrow Officers",       section:"services",   match:["escrow","title officer"] },
  { slug:"proptech",            label:"Proptech / Fintech",            section:"services",   match:["proptech","fintech","tokenization","rwa"] },
  { slug:"bankers",             label:"Bankers",                       section:"lenders",    match:["banker"] },
  { slug:"lenders",             label:"Lenders",                       section:"lenders",    match:["lender","lending"] },
  { slug:"capital-seekers",     label:"Capital Seekers",               section:"investors",  match:["borrower","seeking capital","capital seeker"] },
  { slug:"founders",            label:"Founders & Operators",          section:"services",   match:["founder","ceo","entrepreneur","startup","intrapreneur","operator","owner","principal"] },
];
const PR_BY_SLUG = Object.fromEntries(PERSON_ROLES.map(r => [r.slug, r]));
function personHaystack(p){
  const extra = Array.isArray(p && p.additional_roles) ? p.additional_roles.join(" ") : "";
  return [p && p.role, p && p.professional_title, p && p.headline, extra].filter(Boolean).join(" ").toLowerCase().replace(/_/g," ");
}
function classifyPerson(p){
  const h = personHaystack(p);
  if (h.trim()) { for (const r of PERSON_ROLES) { for (const kw of r.match) { if (h.includes(kw)) return r.slug; } } }
  return "other";
}
function sectionOf(roleSlug){ return (PR_BY_SLUG[roleSlug] && PR_BY_SLUG[roleSlug].section) || "other"; }
function buildPeopleSections(rows){
  const counts = {};
  for (const row of rows) {
    const role = row._role || classifyPerson(row);
    const sec = sectionOf(role);
    (counts[sec] = counts[sec] || {})[role] = (counts[sec][role] || 0) + 1;
  }
  const out = [];
  for (const s of PERSON_SECTIONS) {
    const rc = counts[s.slug]; if (!rc) continue;
    const subs = PERSON_ROLES.filter(r => r.section === s.slug && rc[r.slug]).map(r => ({ slug:r.slug, label:r.label, n:rc[r.slug] }));
    const total = subs.reduce((a,x)=>a+x.n,0);
    if (total > 0) out.push({ slug:s.slug, label:s.label, total, subs });
  }
  return out;
}
const PAGE_SIZE=48;
const PEOPLE_MAX=1000;
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
// Business facet counts (small table) → section tabs + category chips.
async function loadBusinessFacets(){
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
function buildBusinessSections(facets){
  const map=new Map();
  for(const f of facets){
    const ss=cleanSlug(f.section_slug)||"other";
    if(!map.has(ss)) map.set(ss,{slug:ss,label:txt(f.section_label)||"Other",sort:f.section_sort??99,total:0,subs:[]});
    const s=map.get(ss);
    const cs=cleanSlug(f.cat_slug)||"other";
    s.subs.push({slug:cs,label:txt(f.cat_label)||"Other",sort:f.cat_sort??99,n:f.n||0});
    s.total+=(f.n||0);
  }
  const sections=[...map.values()].sort((a,b)=>a.sort-b.sort||a.label.localeCompare(b.label));
  for(const s of sections) s.subs.sort((a,b)=>a.sort-b.sort||a.label.localeCompare(b.label));
  return sections;
}
// All listable public profiles (safe columns only — never email/phone), each
// tagged with its inferred role for section grouping + filtering.
async function loadPeopleAll(){
  const {url,key}=cfg();
  const qs=new URLSearchParams({
    select:"profile_slug,full_name,role,professional_title,company_name,location,avatar_url,headline,additional_roles,updated_at",
    profile_slug:"not.is.null",full_name:"not.is.null",order:"updated_at.desc"
  });
  const res=await fetch(url+"/rest/v1/profiles?"+qs.toString(),{
    headers:{apikey:key,Authorization:"Bearer "+key,Range:"0-"+(PEOPLE_MAX-1),"Range-Unit":"items"}
  });
  if(!res.ok){const body=await res.text().catch(()=> "");throw new Error("people query failed: "+res.status+" "+body.slice(0,200));}
  const rows=await res.json();
  if(!Array.isArray(rows)) return [];
  for(const r of rows) r._role=classifyPerson(r);
  return rows;
}
async function loadBusinesses(section,category,page){
  const params={
    select:"presence_type,name,slug,tagline,short_description,category,industry,location,market,status,section_slug,cat_slug",
    order:"name.asc"
  };
  if(section&&section!=="all") params.section_slug="eq."+section;
  if(category) params.cat_slug="eq."+category;
  try{
    return await fetchRows("public_business_directory",params,page);
  }catch(err){
    console.warn("[public-directory] taxonomy view unavailable, flat fallback:",err&&err.message);
    return await fetchRows("public_presence_previews",{
      select:"presence_type,name,slug,tagline,short_description,category,industry,location,market,status",
      presence_type:"eq.company",status:"eq.active",order:"name.asc"
    },page);
  }
}
function dirPath(kind,section,sub){
  const base=kind==="people"?"/people":kind==="businesses"?"/businesses":"/"+kind;
  if(section&&section!=="all"){let p=base+"/"+section;if(sub)p+="/"+sub;return p;}
  return base;
}
// Shared section tabs + sub-chips for sectioned directories (businesses, people).
function sectionNav(kind,sections,activeSection,activeSub){
  if(!sections.length) return "";
  const grand=sections.reduce((a,s)=>a+s.total,0);
  let secRow='<div class="biz-sections"><a href="'+esc(dirPath(kind))+'" class="'+(activeSection==="all"?"on":"")+'">All <span>'+grand+'</span></a>';
  for(const s of sections){
    secRow+='<a href="'+esc(dirPath(kind,s.slug))+'" class="'+(activeSection===s.slug?"on":"")+'">'+esc(s.label)+' <span>'+s.total+'</span></a>';
  }
  secRow+='</div>';
  let subRow="";
  if(activeSection!=="all"){
    const sec=sections.find(s=>s.slug===activeSection);
    if(sec&&sec.subs.length){
      subRow='<div class="biz-cats"><a href="'+esc(dirPath(kind,sec.slug))+'" class="'+(!activeSub?"on":"")+'">All '+esc(sec.label)+'</a>';
      for(const c of sec.subs){
        subRow+='<a href="'+esc(dirPath(kind,sec.slug,c.slug))+'" class="'+(activeSub===c.slug?"on":"")+'">'+esc(c.label)+' <span>'+c.n+'</span></a>';
      }
      subRow+='</div>';
    }
  }
  return secRow+subRow;
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
function render(ctx){
  const {kind,page,rows,total,sections=[],activeSection="all",activeSub=null}=ctx;
  const sectioned=(kind==="businesses"||kind==="people");
  const label=kind==="people"?"People":kind==="events"?"Events":"Businesses";
  const singular=kind==="people"?"professionals":kind==="events"?"capital and industry events":"companies";

  let secObj=null,subObj=null;
  if(sectioned&&activeSection!=="all"){
    secObj=sections.find(s=>s.slug===activeSection)||null;
    if(secObj&&activeSub) subObj=secObj.subs.find(c=>c.slug===activeSub)||null;
  }
  const path=sectioned?dirPath(kind,activeSection,activeSub):("/"+kind);
  const canonical=ORIGIN+path+(page>1?"?page="+page:"");
  const h1=subObj?subObj.label:secObj?secObj.label:label;
  const title=(subObj?subObj.label+" — "+label:secObj?secObj.label+" — "+label:label)+" — Pegasus Capital Network"+(page>1?" | Page "+page:"");

  let desc;
  if(kind==="businesses"){
    desc=subObj?"Browse "+subObj.label.toLowerCase()+" on Pegasus Capital Network — claimable company pages across private capital, lending, real estate and investment."
      :secObj?"Browse "+secObj.label.toLowerCase()+" on Pegasus Capital Network — companies across private capital, lending, real estate and investment."
      :"Discover companies on Pegasus Capital Network — lenders, private capital, brokers, real estate and transaction services. Public, claimable business pages.";
  }else if(kind==="people"){
    desc=subObj?"Find "+subObj.label.toLowerCase()+" on Pegasus Capital Network — professionals across private capital, lending, real estate and investment."
      :secObj?"Find "+secObj.label.toLowerCase()+" on Pegasus Capital Network — professionals across private capital, lending, real estate and investment."
      :"Discover professionals on Pegasus Capital Network — loan officers, brokers, advisors, agents, developers and investors across private capital and real estate.";
  }else{
    desc="Discover "+singular+" on Pegasus Capital Network. Public profiles connect people, businesses and events across private capital, lending, real estate and investment.";
  }

  const pages=total==null?null:Math.max(1,Math.ceil(total/PAGE_SIZE));
  const hasPrev=page>1,hasNext=pages? page<pages : rows.length===PAGE_SIZE;
  const itemList={"@context":"https://schema.org","@type":"ItemList","name":title,"itemListElement":rows.map((x,i)=>({
    "@type":"ListItem",position:(page-1)*PAGE_SIZE+i+1,
    url:ORIGIN+(kind==="people"?"/u/"+encodeURIComponent(x.profile_slug||""):kind==="events"?"/event/"+encodeURIComponent(x.slug||""):"/business/"+encodeURIComponent(x.slug||""))
  }))};

  const subnav=sectioned?sectionNav(kind,sections,activeSection,activeSub):"";
  const emptyMsg=sectioned&&(secObj||subObj)
    ? (kind==="people"?'No members are listed in this category yet. Be the first — create your free profile.':'No companies are listed in this category yet.')
    : 'No public '+label.toLowerCase()+' are listed yet.';

  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+esc(title)+'</title><meta name="description" content="'+esc(desc)+'"><meta name="robots" content="index,follow,max-image-preview:large">'+
    '<link rel="canonical" href="'+esc(canonical)+'">'+
    (hasPrev?'<link rel="prev" href="'+esc(ORIGIN+path+(page===2?"":"?page="+(page-1)))+'">':'')+
    (hasNext?'<link rel="next" href="'+esc(ORIGIN+path+"?page="+(page+1))+'">':'')+
    '<link rel="stylesheet" href="/css/pegasus.css"><link rel="icon" href="/assets/brand/favicon.ico">'+
    '<script type="application/ld+json">'+JSON.stringify(itemList).replace(/</g,"\\u003c")+'</script>'+
    '<style>.dir-wrap{max-width:1120px;margin:auto;padding:48px 40px 72px}.dir-head{text-align:center;max-width:760px;margin:0 auto 20px}.dir-head h1{font-family:var(--serif);font-size:clamp(34px,5vw,54px);font-weight:400;margin:8px 0 12px}.dir-head p{color:var(--text2);line-height:1.65}.dir-tabs{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin:22px 0 0}.dir-tabs a{padding:8px 14px;border:1px solid var(--border);border-radius:999px;text-decoration:none;color:var(--text2);font-size:12px}.dir-tabs a.on{background:var(--text);color:var(--bg);border-color:var(--text)}'+
    '.biz-sections{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin:18px auto 0;max-width:960px}.biz-sections a{padding:8px 14px;border:1px solid var(--border);border-radius:10px;text-decoration:none;color:var(--text2);font-size:12.5px;font-weight:600}.biz-sections a span{color:var(--text3);font-weight:400}.biz-sections a.on{background:var(--blue);color:#fff;border-color:var(--blue)}.biz-sections a.on span{color:rgba(255,255,255,.75)}'+
    '.biz-cats{display:flex;justify-content:center;gap:7px;flex-wrap:wrap;margin:12px auto 0;max-width:960px}.biz-cats a{padding:6px 12px;border:1px solid var(--border);border-radius:999px;text-decoration:none;color:var(--text2);font-size:11.5px}.biz-cats a span{color:var(--text3)}.biz-cats a.on{background:var(--text);color:var(--bg);border-color:var(--text)}.biz-cats a.on span{color:rgba(255,255,255,.7)}'+
    '.dir-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:26px}.dir-card{background:var(--bg1);border:1px solid var(--border);border-radius:16px;box-shadow:var(--sh-card)}.dir-link{display:flex;gap:16px;padding:20px;text-decoration:none}.dir-avatar{width:68px;height:68px;border-radius:50%;object-fit:cover;flex:none}.dir-initial{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#17315A,#0E1E36);color:#fff;font-family:var(--serif);font-size:28px}.dir-card h2{font-size:16px;margin:2px 0 5px;color:var(--text)}.dir-meta{font-size:12px;color:var(--text3);margin:0}.dir-desc{font-size:12.5px;line-height:1.5;color:var(--text2);margin:8px 0 0}.dir-open{display:inline-block;margin-top:10px;font-size:11.5px;color:var(--blue)}.dir-pager{display:flex;justify-content:center;gap:10px;margin-top:30px}.dir-pager a{padding:9px 14px;border:1px solid var(--border);border-radius:9px;text-decoration:none;color:var(--text2)}.dir-empty{text-align:center;padding:50px;color:var(--text3)}@media(max-width:760px){.dir-wrap{padding:32px 20px 54px}.dir-grid{grid-template-columns:1fr}}</style></head><body>'+
    '<nav class="pub-nav"><a class="brand" href="/"><img class="brand-mark" src="/assets/brand/pegasus-symbol.svg" alt="Pegasus"><span>Pegasus Network</span></a><div class="pub-links"><a href="/people">People</a><a href="/businesses">Businesses</a><a href="/events">Events</a><a href="/explore.html">Explore</a></div><div class="nav-cta" id="dirNavCta"><a class="btn btn-ghost" href="/signin.html">Sign In</a><a class="btn btn-pri" href="/signup.html">Create Free Profile</a></div></nav>'+
    // Page is CDN-cached for everyone, so swap the guest CTA client-side for signed-in members.
    '<script>(function(){try{var raw=localStorage.getItem("pegasus.auth");if(!raw)return;var pj=JSON.parse(raw);if(!(pj&&(pj.access_token||(pj.currentSession&&pj.currentSession.access_token))))return;var c=document.getElementById("dirNavCta");if(!c)return;var s="";try{s=localStorage.getItem("peg_slug")||"";}catch(_){}c.innerHTML=\'<a class="btn btn-ghost" href="/members.html">Members Network</a><a class="btn btn-ghost" href="\'+(s?"/u/"+encodeURIComponent(s):"/profile-edit.html")+\'">My Profile</a><a class="btn btn-pri" href="/dashboard.html">My Workspace →</a>\';}catch(_){}})();</script>'+
    '<main class="dir-wrap"><header class="dir-head"><div class="eyebrow" style="justify-content:center">Public Network</div><h1>'+esc(h1)+'</h1><p>'+esc(desc)+'</p><div class="dir-tabs">'+
    '<a href="/people" class="'+(kind==="people"?"on":"")+'">People</a><a href="/businesses" class="'+(kind==="businesses"?"on":"")+'">Businesses</a><a href="/events" class="'+(kind==="events"?"on":"")+'">Events</a></div>'+subnav+'</header>'+
    (rows.length?'<section class="dir-grid">'+rows.map(x=>card(x,kind)).join("")+'</section>':'<div class="dir-empty">'+esc(emptyMsg)+'</div>')+
    '<nav class="dir-pager" aria-label="Pagination">'+(hasPrev?'<a href="'+esc(path+(page===2?"":"?page="+(page-1)))+'">← Previous</a>':'')+(hasNext?'<a href="'+esc(path+"?page="+(page+1))+'">Next →</a>':'')+'</nav></main>'+
    '<footer style="text-align:center;padding:28px;color:var(--text3);border-top:1px solid var(--border)"><a href="/" style="color:inherit">Pegasus Capital Network</a> · Public professional discovery network</footer></body></html>';
}
function errPage(status,title){
  return new Response('<!doctype html><html><head><meta name="robots" content="noindex,nofollow"><title>'+esc(title)+'</title></head><body><h1>'+esc(title)+'</h1><a href="/">Pegasus Capital Network</a></body></html>',{status,headers:{"Content-Type":"text/html; charset=utf-8","X-Robots-Tag":"noindex,nofollow","Cache-Control":"no-store"}});
}

export default async (request)=>{
  const u=new URL(request.url);
  // Netlify rewrites (/businesses/:section → ?kind=…&section=…) hand the
  // function the ORIGINAL request URL, so the rewrite's query params are not
  // in u.searchParams. Derive kind/section/sub from the pretty path first and
  // only fall back to query params (direct /.netlify/functions/… calls).
  const publicPath=u.pathname.match(/^\/(people|businesses|events)(?:\/([^\/]+))?(?:\/([^\/]+))?\/?$/);
  const requested=publicPath ? publicPath[1] : u.searchParams.get("kind");
  const kind=requested==="businesses"?"businesses":requested==="events"?"events":"people";
  if(publicPath && publicPath[2] && !u.searchParams.get("section")) u.searchParams.set("section",publicPath[2]);
  if(publicPath && publicPath[3]){
    const subKey=kind==="people"?"role":"category";
    if(!u.searchParams.get(subKey)) u.searchParams.set(subKey,publicPath[3]);
  }
  const page=pageNum(u.searchParams.get("page"));
  try{
    if(kind==="businesses"){
      const facets=await loadBusinessFacets();
      const sections=buildBusinessSections(facets);
      let activeSection=cleanSlug(u.searchParams.get("section"))||"all";
      let activeSub=cleanSlug(u.searchParams.get("category"))||null;
      if(activeSection!=="all" && !sections.some(s=>s.slug===activeSection)){activeSection="all";activeSub=null;}
      if(activeSub){const sec=sections.find(s=>s.slug===activeSection);if(!sec||!sec.subs.some(c=>c.slug===activeSub)) activeSub=null;}
      const {rows,total}=await loadBusinesses(activeSection,activeSub,page);
      if(page>1&&!rows.length) return errPage(404,"Directory page not found");
      return new Response(render({kind,page,rows,total,sections,activeSection,activeSub}),{status:200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"public, max-age=0, s-maxage=300, stale-while-revalidate=600","Netlify-Vary":"query=page|section|category","X-Robots-Tag":"index,follow,max-image-preview:large"}});
    }
    if(kind==="people"){
      const all=await loadPeopleAll();
      const sections=buildPeopleSections(all);
      let activeSection=cleanSlug(u.searchParams.get("section"))||"all";
      let activeSub=cleanSlug(u.searchParams.get("role"))||null;
      if(activeSection!=="all" && !sections.some(s=>s.slug===activeSection)){activeSection="all";activeSub=null;}
      if(activeSub){const sec=sections.find(s=>s.slug===activeSection);if(!sec||!sec.subs.some(c=>c.slug===activeSub)) activeSub=null;}
      let rows=all;
      if(activeSection!=="all") rows=rows.filter(r=>sectionOf(r._role)===activeSection);
      if(activeSub) rows=rows.filter(r=>r._role===activeSub);
      const total=rows.length;
      const pageRows=rows.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
      if(page>1&&!pageRows.length) return errPage(404,"Directory page not found");
      return new Response(render({kind,page,rows:pageRows,total,sections,activeSection,activeSub}),{status:200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"public, max-age=0, s-maxage=300, stale-while-revalidate=600","Netlify-Vary":"query=page|section|role","X-Robots-Tag":"index,follow,max-image-preview:large"}});
    }
    const {rows,total}=await fetchRows("public_presence_previews",{
      select:"presence_type,name,slug,tagline,short_description,category,industry,location,market,status",
      presence_type:"eq.event",status:"eq.active",order:"name.asc"
    },page);
    if(page>1&&!rows.length) return errPage(404,"Directory page not found");
    return new Response(render({kind:"events",page,rows,total}),{status:200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"public, max-age=0, s-maxage=300, stale-while-revalidate=600","Netlify-Vary":"query=page","X-Robots-Tag":"index,follow,max-image-preview:large"}});
  }catch(err){
    console.error("[public-directory]",err);
    // Never 503 the directory — fall back to a flat, un-sectioned list.
    try{
      if(kind==="people"){
        const all=await loadPeopleAll();
        const pageRows=all.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
        return new Response(render({kind:"people",page,rows:pageRows,total:all.length}),{status:200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"public, max-age=0, s-maxage=60","X-Robots-Tag":"index,follow,max-image-preview:large"}});
      }
      const type=kind==="events"?"event":"company";
      const {rows,total}=await fetchRows("public_presence_previews",{
        select:"presence_type,name,slug,tagline,short_description,category,industry,location,market,status",
        presence_type:"eq."+type,status:"eq.active",order:"name.asc"
      },page);
      return new Response(render({kind,page,rows,total}),{status:200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"public, max-age=0, s-maxage=60","X-Robots-Tag":"index,follow,max-image-preview:large"}});
    }catch(err2){
      console.error("[public-directory:fallback]",err2);
      return errPage(503,"Directory temporarily unavailable");
    }
  }
};
