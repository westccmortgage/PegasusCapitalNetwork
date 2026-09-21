// Pegasus SEO P0 — server-delivered metadata for public Person profiles.
// The visual page remains public-profile.html and hydrates exactly as before.
const ORIGIN = 'https://pegasuscapitalnetwork.com';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://trdwsssouhpawhfdkfqf.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON ||
  'sb_publishable_hrR8wI6hM921mnxk7bBE_A_YKxWsoBI';

const PROFILE_FIELDS = [
  'id','profile_slug','full_name','role','company_name','headline','bio','location',
  'website','avatar_url','professional_title','current_focus','linkedin_url',
  'facebook_url','instagram_url','x_url','youtube_url','tiktok_url','updated_at'
].join(',');

function escHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function cleanSlug(v) {
  const s = String(v || '').trim();
  return /^[a-z0-9][a-z0-9-]*$/i.test(s) ? s : '';
}
function text(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }
function truncate(v, n) {
  const s = text(v);
  return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
}
function safeHttp(v) {
  const s = text(v);
  return /^https?:\/\//i.test(s) ? s : '';
}
function roleLabel(v) {
  return text(v).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function replaceOrInsert(html, regex, replacement, before='</head>') {
  if (regex.test(html)) return html.replace(regex, replacement);
  return html.replace(before, replacement + '\n' + before);
}

async function getProfile(slug) {
  const params = new URLSearchParams();
  params.set('select', PROFILE_FIELDS);
  params.set('profile_slug', 'eq.' + slug);
  params.set('limit', '1');
  const res = await fetch(SUPABASE_URL + '/rest/v1/profiles?' + params.toString(), {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: 'Bearer ' + SUPABASE_ANON,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('profile query failed: ' + res.status + ' ' + body.slice(0, 300));
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function getTemplate() {
  const base = process.env.DEPLOY_PRIME_URL || process.env.URL || ORIGIN;
  const res = await fetch(base.replace(/\/$/, '') + '/public-profile.html?seo_template=1', {
    headers: { 'User-Agent': 'Pegasus-SEO-Renderer/1.0' },
  });
  if (!res.ok) throw new Error('profile template fetch failed: ' + res.status);
  return await res.text();
}

function renderSeo(html, p) {
  const slug = cleanSlug(p.profile_slug);
  const name = text(p.full_name) || 'Pegasus Member';
  const canonical = ORIGIN + '/u/' + encodeURIComponent(slug);
  const job = text(p.professional_title) || roleLabel(p.role);
  const rawDesc = text(p.headline) || text(p.current_focus) || text(p.bio) ||
    [job, text(p.company_name), text(p.location)].filter(Boolean).join(' · ');
  const desc = truncate(rawDesc || (name + ' on Pegasus Capital Network'), 160);
  const title = name + (job ? ' — ' + job : '') + ' | Pegasus Capital Network';
  const image = safeHttp(p.avatar_url);

  html = replaceOrInsert(html, /<title>[\s\S]*?<\/title>/i,
    '<title>' + escHtml(title) + '</title>');
  html = replaceOrInsert(html, /<link\s+rel=["']canonical["'][^>]*>/i,
    '<link rel="canonical" href="' + escHtml(canonical) + '">');
  html = replaceOrInsert(html, /<meta\s+name=["']description["'][^>]*>/i,
    '<meta name="description" content="' + escHtml(desc) + '">');

  // Server response is explicitly indexable for an existing public profile.
  html = replaceOrInsert(html, /<meta\s+name=["']robots["'][^>]*>/i,
    '<meta name="robots" content="index,follow,max-image-preview:large">');

  const og = [
    '<meta property="og:type" content="profile">',
    '<meta property="og:site_name" content="Pegasus Capital Network">',
    '<meta property="og:title" content="' + escHtml(title) + '">',
    '<meta property="og:description" content="' + escHtml(desc) + '">',
    '<meta property="og:url" content="' + escHtml(canonical) + '">',
    image ? '<meta property="og:image" content="' + escHtml(image) + '">' : '',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="' + escHtml(title) + '">',
    '<meta name="twitter:description" content="' + escHtml(desc) + '">',
    image ? '<meta name="twitter:image" content="' + escHtml(image) + '">' : ''
  ].filter(Boolean).join('\n');

  const sameAs = [
    safeHttp(p.website), safeHttp(p.linkedin_url), safeHttp(p.facebook_url),
    safeHttp(p.instagram_url), safeHttp(p.x_url), safeHttp(p.youtube_url),
    safeHttp(p.tiktok_url)
  ].filter(Boolean);

  const person = {
    '@type': 'Person',
    name,
    url: canonical,
  };
  if (job) person.jobTitle = job;
  if (desc) person.description = desc;
  if (image) person.image = image;
  if (sameAs.length) person.sameAs = sameAs;
  if (text(p.company_name)) person.worksFor = { '@type': 'Organization', name: text(p.company_name) };

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: canonical,
    name: title,
    description: desc,
    mainEntity: person,
  };
  const jsonLd = '<script type="application/ld+json">' +
    JSON.stringify(schema).replace(/</g, '\\u003c') + '</script>';

  html = html.replace('</head>', og + '\n' + jsonLd + '\n</head>');
  return html;
}

function simplePage(status, title, message) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': status === 404 ? 'public, max-age=60' : 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">' +
      '<title>' + escHtml(title) + '</title></head><body><main><h1>' + escHtml(title) +
      '</h1><p>' + escHtml(message) + '</p><p><a href="/">Pegasus Capital Network</a></p></main></body></html>',
  };
}

exports.handler = async (event) => {
  const slug = cleanSlug(event.queryStringParameters && event.queryStringParameters.slug);
  if (!slug) return simplePage(404, 'Profile not found', 'This profile does not exist.');

  try {
    const [profile, template] = await Promise.all([getProfile(slug), getTemplate()]);
    if (!profile) return simplePage(404, 'Profile not found', 'This profile does not exist.');

    const html = renderSeo(template, profile);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
        'X-Robots-Tag': 'index, follow, max-image-preview:large',
        'Link': '<' + ORIGIN + '/u/' + encodeURIComponent(slug) + '>; rel="canonical"',
      },
      body: html,
    };
  } catch (err) {
    console.error('[profile-seo-page]', err);
    return simplePage(503, 'Profile temporarily unavailable', 'Please try again shortly.');
  }
};
