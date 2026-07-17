#!/usr/bin/env node
// Resource synchronization — verify every Site Registry page and produce a
// link-health report. Run from a network-enabled machine:
//
//   npm run sync:resources
//
// What it does, per registry resource (allowlisted domains ONLY):
//   1. Fetches robots.txt and respects Disallow rules for our paths.
//   2. Reads sitemap.xml when present (recorded for discovery, not crawled).
//   3. Fetches the canonical URL, following redirects (recorded).
//   4. Rejects preview/staging/login/admin/account/private URLs.
//   5. Extracts title, meta description, canonical link, h1/h2 headings,
//      clean main text (nav/footer stripped), language, state/city/county
//      references, topic tags, content hash, HTTP status.
//   6. Writes docs/resource-index.json (the index) and
//      docs/link-health.md (human report: broken links, redirects, drift).
//
// The script NEVER adds new URLs to the registry — it only verifies what the
// owner has approved in src/lib/resources/site-registry.js. To mark a resource
// verified, review the report and set `verified: true` (+ lastVerifiedAt) in
// the registry. No language model is involved anywhere in this pipeline.

import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { SITE_REGISTRY, EXCLUDED_DOMAINS, EXCLUDED_URL_PATTERNS } =
  await import(join(root, 'src/lib/resources/site-registry.js'));

const TIMEOUT_MS = 12000;
const UA = 'WCCI-ResourceSync/1.0 (+https://wcci.online; owner-run verification)';

const PRIVATE_PATH_RE = /\/(login|signin|admin|account|dashboard|wp-admin|preview|staging|api)(\/|$|\?)/i;

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,text/plain,*/*' } });
    const text = await res.text();
    return { ok: res.ok, status: res.status, finalUrl: res.url, text };
  } catch (e) {
    return { ok: false, status: 0, finalUrl: url, text: '', error: e.message || String(e) };
  } finally { clearTimeout(timer); }
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')       // repeated navigation
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ') // repeated footer
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&amp;|&quot;|&#\d+;|&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pick(re, html) { const m = html.match(re); return m ? m[1].trim().replace(/\s+/g, ' ') : ''; }

const STATE_WORDS = { california: 'CA', florida: 'FL', ca: 'CA', fl: 'FL' };

function extract(resource, html, finalUrl, status) {
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i, html);
  const description = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i, html) ||
    pick(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i, html);
  const canonical = pick(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i, html);
  const langAttr = pick(/<html[^>]+lang=["']([a-z-]+)["']/i, html) || 'en';
  const headings = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)].map(m => stripTags(m[1])).filter(Boolean).slice(0, 12);
  const clean = stripTags(html).slice(0, 4000);
  const lower = clean.toLowerCase();
  const stateTags = [...new Set(Object.entries(STATE_WORDS).filter(([w]) => new RegExp(`\\b${w}\\b`).test(lower)).map(([, s]) => s))];
  const cityTags = (resource.cities || []).filter(c => lower.includes(c));
  const countyTags = (resource.counties || []).filter(c => lower.includes(c));
  const topicTags = (resource.topics || []).filter(t => lower.includes(t.replace(/_/g, ' ')) || lower.includes(t.replace(/_/g, '-')));
  return {
    id: resource.id,
    site_id: resource.domain,
    canonical_url: canonical || resource.canonicalUrl,
    final_url: finalUrl,
    redirected: finalUrl.replace(/\/$/, '') !== resource.canonicalUrl.replace(/\/$/, ''),
    title, description,
    headings,
    clean_content: clean,
    locale: langAttr.slice(0, 2),
    state_tags: stateTags, county_tags: countyTags, city_tags: cityTags, topic_tags: topicTags,
    audience_tags: resource.audiences,
    trust_intent_tags: resource.trustIntents || [],
    content_hash: createHash('sha256').update(clean).digest('hex').slice(0, 16),
    status_code: status,
    last_crawled_at: new Date().toISOString(),
  };
}

function isExcluded(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (EXCLUDED_DOMAINS.some(d => host === d || host.endsWith('.' + d))) return true;
  } catch { return true; }
  return EXCLUDED_URL_PATTERNS.some(re => re.test(url)) || PRIVATE_PATH_RE.test(url);
}

async function robotsAllows(domain, path) {
  const res = await fetchText(`https://${domain}/robots.txt`);
  if (!res.ok) return { allowed: true, hasRobots: false };
  let inStar = false;
  const disallows = [];
  for (const line of res.text.split('\n')) {
    const l = line.trim();
    if (/^user-agent:\s*\*/i.test(l)) { inStar = true; continue; }
    if (/^user-agent:/i.test(l)) { inStar = false; continue; }
    const m = inStar && l.match(/^disallow:\s*(\S*)/i);
    if (m && m[1]) disallows.push(m[1]);
  }
  return { allowed: !disallows.some(d => path.startsWith(d)), hasRobots: true, disallows };
}

async function hasSitemap(domain) {
  const res = await fetchText(`https://${domain}/sitemap.xml`);
  return res.ok && /<(urlset|sitemapindex)/i.test(res.text);
}

// ── Main ──
const results = [];
const health = [];
const domainsChecked = new Map(); // domain -> {robots, sitemap}

for (const r of SITE_REGISTRY) {
  const url = r.canonicalUrl;
  if (isExcluded(url)) { health.push({ id: r.id, url, verdict: 'EXCLUDED (never crawl)' }); continue; }
  const u = new URL(url);
  const domain = u.hostname.replace(/^www\./, '');

  if (!domainsChecked.has(domain)) {
    const robots = await robotsAllows(domain, '/');
    const sitemap = robots.allowed ? await hasSitemap(domain) : false;
    domainsChecked.set(domain, { robots, sitemap });
  }
  const { robots, sitemap } = domainsChecked.get(domain);
  const pathAllowed = (await robotsAllows(domain, u.pathname)).allowed;
  if (!pathAllowed) { health.push({ id: r.id, url, verdict: 'BLOCKED by robots.txt' }); continue; }

  const page = await fetchText(url);
  if (!page.ok) {
    health.push({ id: r.id, url, verdict: `UNREACHABLE (status ${page.status}${page.error ? ', ' + page.error : ''})` });
    continue;
  }
  if (isExcluded(page.finalUrl)) { health.push({ id: r.id, url, verdict: `REDIRECTED TO EXCLUDED URL: ${page.finalUrl}` }); continue; }
  const rec = extract(r, page.text, page.finalUrl, page.status);
  rec.robots_present = robots.hasRobots;
  rec.sitemap_present = sitemap;
  results.push(rec);
  health.push({
    id: r.id, url,
    verdict: rec.redirected ? `OK (redirected → ${page.finalUrl})` : 'OK',
    title: rec.title.slice(0, 80),
  });
  process.stdout.write(`✓ ${r.id}\n`);
}

mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs', 'resource-index.json'), JSON.stringify(results, null, 2));

const ts = new Date().toISOString();
const ok = health.filter(h => h.verdict.startsWith('OK')).length;
const broken = health.filter(h => h.verdict.startsWith('UNREACHABLE') || h.verdict.startsWith('REDIRECTED TO EXCLUDED')).length;
const md = [
  `# Resource Link-Health Report`,
  ``,
  `Generated: ${ts}`,
  ``,
  `| Result | Count |`,
  `|---|---|`,
  `| OK | ${ok} |`,
  `| Broken / bad redirect | ${broken} |`,
  `| Blocked or excluded | ${health.length - ok - broken} |`,
  ``,
  `| Resource | URL | Verdict |`,
  `|---|---|---|`,
  ...health.map(h => `| ${h.id} | ${h.url} | ${h.verdict} |`),
  ``,
  broken || ok === 0
    ? `> ⚠️ Review failures above. Resources that fail must stay (or be set) \`verified: false\` in the registry until fixed.`
    : `> ✅ All reachable pages verified. You may stamp \`lastVerifiedAt: "${ts.slice(0, 10)}"\` on the passing registry entries.`,
].join('\n');
writeFileSync(join(root, 'docs', 'link-health.md'), md);

console.log(`\nDone. ${ok} OK, ${broken} broken, ${health.length - ok - broken} blocked/excluded.`);
console.log('Reports: docs/resource-index.json, docs/link-health.md');
if (ok === 0) {
  console.log('\n⚠️  Nothing was reachable — likely no outbound network from this machine.');
  console.log('   Run again from a network-enabled machine before flipping any verified flags.');
}
