// Pegasus SEO P0 — dynamic public Person sitemap.
// Uses the same public Supabase surface as the browser; no service-role key.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://trdwsssouhpawhfdkfqf.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON ||
  'sb_publishable_hrR8wI6hM921mnxk7bBE_A_YKxWsoBI';

const ORIGIN = 'https://pegasuscapitalnetwork.com';
const PAGE_SIZE = 1000;
const MAX_URLS = 45000;

function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cleanSlug(value) {
  const s = String(value || '').trim();
  return /^[a-z0-9][a-z0-9-]*$/i.test(s) ? s : '';
}

async function fetchProfiles() {
  const out = [];
  for (let offset = 0; offset < MAX_URLS; offset += PAGE_SIZE) {
    const params = new URLSearchParams();
    params.set('select', 'profile_slug,updated_at');
    params.set('profile_slug', 'not.is.null');
    params.set('full_name', 'not.is.null');
    params.set('order', 'updated_at.desc');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?${params.toString()}`, {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
        Range: `${offset}-${offset + PAGE_SIZE - 1}`,
        'Range-Unit': 'items',
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`profiles sitemap query failed: ${res.status} ${body.slice(0, 300)}`);
    }
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out.slice(0, MAX_URLS);
}

exports.handler = async () => {
  try {
    const rows = await fetchProfiles();
    const seen = new Set();
    const urls = [];

    for (const row of rows) {
      const slug = cleanSlug(row.profile_slug);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      const lastmod = row.updated_at && /^\d{4}-\d{2}-\d{2}/.test(row.updated_at)
        ? String(row.updated_at).slice(0, 10)
        : '';
      urls.push(
        '  <url>\n' +
        `    <loc>${xmlEscape(ORIGIN + '/u/' + encodeURIComponent(slug))}</loc>\n` +
        (lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : '') +
        '    <changefreq>weekly</changefreq>\n' +
        '    <priority>0.8</priority>\n' +
        '  </url>'
      );
    }

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.join('\n') + '\n' +
      '</urlset>\n';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=900, s-maxage=900',
        'X-Robots-Tag': 'noindex',
      },
      body: xml,
    };
  } catch (err) {
    console.error('[entity-sitemap]', err);
    return {
      statusCode: 503,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
      body: 'Sitemap temporarily unavailable',
    };
  }
};
