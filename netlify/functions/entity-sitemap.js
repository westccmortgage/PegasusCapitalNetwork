// Pegasus SEO — dynamic sitemap index + entity sitemaps.
// Public data only; uses the publishable Supabase key and public read surfaces.

const ORIGIN = "https://pegasuscapitalnetwork.com";
const PAGE_SIZE = 1000;
const MAX_URLS = 49000;

function env(name) {
  return globalThis.Netlify?.env?.get(name) || "";
}
function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function cleanSlug(value) {
  const s = String(value || "").trim();
  return /^[a-z0-9][a-z0-9-]*$/i.test(s) ? s : "";
}
function supabaseConfig() {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY");
  return { url: url.replace(/\/$/, ""), key };
}
async function restRows(path, query) {
  const { url, key } = supabaseConfig();
  const out = [];
  for (let offset = 0; offset < MAX_URLS; offset += PAGE_SIZE) {
    const params = new URLSearchParams(query);
    const res = await fetch(url + "/rest/v1/" + path + "?" + params.toString(), {
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        Range: offset + "-" + (offset + PAGE_SIZE - 1),
        "Range-Unit": "items",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(path + " sitemap query failed: " + res.status + " " + body.slice(0, 300));
    }
    const rows = await res.json();
    out.push(...rows);
    if (!Array.isArray(rows) || rows.length < PAGE_SIZE) break;
  }
  return out.slice(0, MAX_URLS);
}
function urlset(urls) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.join("\n") + "\n</urlset>\n";
}
function urlNode(loc, lastmod, priority="0.8") {
  return "  <url>\n" +
    "    <loc>" + xmlEscape(loc) + "</loc>\n" +
    (lastmod ? "    <lastmod>" + xmlEscape(lastmod) + "</lastmod>\n" : "") +
    "    <changefreq>weekly</changefreq>\n" +
    "    <priority>" + priority + "</priority>\n" +
    "  </url>";
}
async function peopleSitemap() {
  const rows = await restRows("profiles", {
    select: "profile_slug,updated_at,full_name",
    profile_slug: "not.is.null",
    full_name: "not.is.null",
    order: "updated_at.desc",
  });
  const seen = new Set();
  const urls = [];
  for (const row of rows) {
    const slug = cleanSlug(row.profile_slug);
    if (!slug || seen.has(slug) || !String(row.full_name || "").trim()) continue;
    seen.add(slug);
    const lastmod = row.updated_at && /^\d{4}-\d{2}-\d{2}/.test(row.updated_at)
      ? String(row.updated_at).slice(0, 10) : "";
    urls.push(urlNode(ORIGIN + "/u/" + encodeURIComponent(slug), lastmod, "0.9"));
  }
  return urlset(urls);
}
async function presenceSitemap(kind) {
  const type = kind === "events" ? "event" : "company";
  const segment = kind === "events" ? "event" : "business";
  const rows = await restRows("public_presence_previews", {
    select: "presence_type,name,slug,status",
    presence_type: "eq." + type,
    status: "eq.active",
    order: "name.asc",
  });
  const seen = new Set();
  const urls = [];
  for (const row of rows) {
    const slug = cleanSlug(row.slug);
    if (!slug || seen.has(slug) || !String(row.name || "").trim()) continue;
    seen.add(slug);
    urls.push(urlNode(ORIGIN + "/" + segment + "/" + encodeURIComponent(slug), "", "0.8"));
  }
  return urlset(urls);
}
function sitemapIndex() {
  const maps = ["sitemap-people.xml", "sitemap-businesses.xml", "sitemap-events.xml"];
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    maps.map(m => "  <sitemap><loc>" + xmlEscape(ORIGIN + "/" + m) + "</loc></sitemap>").join("\n") +
    "\n</sitemapindex>\n";
}
function response(body, status=200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": status === 200 ? "public, max-age=900, s-maxage=900" : "no-store",
    },
  });
}

export default async (request) => {
  try {
    const u = new URL(request.url);
    const kind = u.searchParams.get("kind") || "index";
    if (kind === "people") return response(await peopleSitemap());
    if (kind === "businesses") return response(await presenceSitemap("businesses"));
    if (kind === "events") return response(await presenceSitemap("events"));
    return response(sitemapIndex());
  } catch (err) {
    console.error("[entity-sitemap]", err);
    return response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>', 503);
  }
};
