// Offline regression checks for Netlify's public-path function rewrites.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

globalThis.Netlify = { env: { get: (name) => ({
  SUPABASE_URL: "https://db.example.test",
  SUPABASE_PUBLISHABLE_KEY: "public-test-key"
})[name] || "" } };

const template = '<!doctype html><html><head><title>Default</title><link rel="canonical" href="https://pegasuscapitalnetwork.com/default"><meta name="robots" content="noindex,nofollow"></head><body></body></html>';
const profile = { id: "person-1", profile_slug: "jane-doe", full_name: "Jane Doe", role: "broker", headline: "Capital broker" };
const company = { id: "business-1", presence_type: "company", name: "Example Capital", slug: "example-capital", short_description: "Commercial capital.", visibility: "public_preview", status: "active" };
const event = { id: "event-1", presence_type: "event", name: "Capital Forum", slug: "capital-forum", short_description: "Industry event.", visibility: "public_preview", status: "active" };

globalThis.fetch = async (input, init) => {
  const u = new URL(input);
  if (u.pathname.endsWith(".html")) return new Response(template);
  if (u.pathname === "/rest/v1/profiles") {
    // The live database rejects the optional field set with 401/42501.
    if (u.searchParams.get("select")?.includes("linkedin_url")) return Response.json({ code: "42501" }, { status: 401 });
    const slugFilter = u.searchParams.get("profile_slug");
    const rows = slugFilter?.startsWith("eq.") && slugFilter !== "eq.jane-doe" ? [] : [profile];
    return Response.json(rows, { headers: { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` } });
  }
  if (u.pathname === "/rest/v1/rpc/get_presence_page_by_slug") {
    const slug = JSON.parse(init?.body || "{}").p_slug;
    if (slug === "members-only-forum") return Response.json({ access: "locked" });
    const p = slug === company.slug ? company : slug === event.slug ? event : null;
    return Response.json(p ? { access: "full", presence: p } : null);
  }
  if (u.pathname === "/rest/v1/public_presence_previews") {
    const p = u.searchParams.get("presence_type") === "eq.event" ? event : company;
    return Response.json([p], { headers: { "content-range": "0-0/1" } });
  }
  throw new Error(`Unexpected fetch: ${u}`);
};

async function fn(name) {
  const mod = await import(pathToFileURL(resolve("netlify/functions", name + ".js")));
  return mod.default;
}
const personPage = await fn("profile-seo-page");
const presencePage = await fn("presence-seo-page");
const directory = await fn("public-directory");
const sitemap = await fn("entity-sitemap");
const get = (url) => new Request("https://pegasuscapitalnetwork.com" + url);

let r = await personPage(get("/u/jane-doe"));
assert.equal(r.status, 200);
let html = await r.text();
assert.match(html, /<h1[^>]*>Jane Doe<\/h1>/);
assert.match(html, /<link rel="canonical" href="https:\/\/pegasuscapitalnetwork.com\/u\/jane-doe">/);
assert.doesNotMatch(html, /noindex/);
r = await personPage(get("/u/missing-person"));
assert.equal(r.status, 404);

r = await presencePage(get("/business/example-capital"));
assert.equal(r.status, 200);
assert.match(await r.text(), /Example Capital/);
r = await presencePage(get("/event/capital-forum"));
assert.equal(r.status, 200);
assert.match(await r.text(), /Capital Forum/);
r = await presencePage(get("/event/example-capital"));
assert.equal(r.status, 404);
r = await presencePage(get("/event/members-only-forum"));
assert.equal(r.status, 200);
assert.match(r.headers.get("x-robots-tag"), /noindex/);
assert.doesNotMatch(await r.text(), /members-only-forum/);

for (const [path, title] of [["/people", "People"], ["/businesses", "Businesses"], ["/events", "Events"]]) {
  r = await directory(get(path));
  assert.equal(r.status, 200);
  assert.match(await r.text(), new RegExp(`<title>${title} — Pegasus Capital Network`));
}
for (const [path, fragment] of [["/sitemap-entities.xml", "sitemapindex"], ["/sitemap-people.xml", "/u/jane-doe"], ["/sitemap-businesses.xml", "/business/example-capital"], ["/sitemap-events.xml", "/event/capital-forum"]]) {
  r = await sitemap(get(path));
  assert.equal(r.status, 200);
  const xml = await r.text();
  assert.ok(xml.includes(fragment), path + ": " + xml.slice(0, 300));
}
console.log("SEO P0 public-route regression checks passed");
