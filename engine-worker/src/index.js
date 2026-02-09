// ============================================================================
// GentlyTold Engine — Full Pipeline Worker
// Submit → Preview → Approve → Publish → Notify
// ============================================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(new Response(null, { status: 204 }));
    }

    try {
      // Health check
      if (path === '/api/health' && request.method === 'GET') {
        return corsResponse(Response.json({
          status: 'ok',
          service: 'gentlytold-engine',
          timestamp: new Date().toISOString(),
        }));
      }

      // POST /api/submit — Receive intake form data, generate memorial, store draft
      if (path === '/api/submit' && request.method === 'POST') {
        return corsResponse(await handleSubmit(request, env));
      }

      // GET /preview/{id} — Serve draft with preview banner
      const previewMatch = path.match(/^\/preview\/([a-z0-9-]+)$/);
      if (previewMatch && request.method === 'GET') {
        return corsResponse(await handlePreview(previewMatch[1], env, url));
      }

      // GET or POST /api/approve/{id} — Approve and publish
      const approveMatch = path.match(/^\/api\/approve\/([a-z0-9-]+)$/);
      if (approveMatch && (request.method === 'GET' || request.method === 'POST')) {
        return corsResponse(await handleApprove(approveMatch[1], url, env));
      }

      // GET /m/{id} — Serve published memorial
      const publishedMatch = path.match(/^\/m\/([a-z0-9-]+)$/);
      if (publishedMatch && request.method === 'GET') {
        return corsResponse(await handlePublished(publishedMatch[1], env));
      }

      return corsResponse(Response.json({ error: 'Not found' }, { status: 404 }));
    } catch (err) {
      console.error('Unhandled error:', err);
      return corsResponse(Response.json({ error: 'Internal server error', message: err.message }, { status: 500 }));
    }
  }
};

// ============================================================================
// CORS
// ============================================================================

function corsResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// ============================================================================
// POST /api/submit — Generate memorial page from intake form data
// ============================================================================

async function handleSubmit(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = body.personName1 || body.name;
  if (!name) {
    return Response.json({ error: 'Missing required field: personName1 (or name)' }, { status: 400 });
  }

  // Generate slug from name + random suffix
  const slug = generateSlug(name, body.personName2);
  const token = crypto.randomUUID();

  // Map intake form fields to renderMemorialPage data structure
  const pageData = mapFormToPageData(body);

  // Generate the HTML
  const html = renderMemorialPage(pageData);

  // Store as draft
  const draft = {
    html,
    data: pageData,
    formData: body,
    token,
    email: body.formEmail || '',
    funeralHomeName: body.funeralHomeName || '',
    createdAt: new Date().toISOString(),
  };

  await env.PAGES.put(`draft:${slug}`, JSON.stringify(draft));

  return Response.json({
    success: true,
    previewUrl: `/preview/${slug}`,
    id: slug,
  });
}

// ============================================================================
// GET /preview/{id} — Serve draft with preview banner
// ============================================================================

async function handlePreview(id, env, url) {
  const draftJson = await env.PAGES.get(`draft:${id}`);
  if (!draftJson) {
    return new Response(notFoundPage('Draft Not Found', 'This preview link is no longer valid or has already been published.'), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const draft = JSON.parse(draftJson);
  const approveUrl = `${url.origin}/api/approve/${id}?token=${draft.token}`;
  const displayName = draft.data.name || 'Memorial';

  // Inject preview banner after <body>
  const bannerHtml = `
<div id="gt-preview-banner" style="
  position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
  background: linear-gradient(135deg, #1a1510, #2a2015);
  border-bottom: 2px solid #c4a478;
  padding: 1.25rem 1.5rem;
  font-family: 'Lato', -apple-system, sans-serif;
  box-shadow: 0 4px 24px rgba(0,0,0,0.5);
">
  <div style="max-width: 800px; margin: 0 auto; text-align: center;">
    <p style="color: #c4a478; font-size: 1rem; margin: 0 0 0.75rem 0; font-weight: 400;">
      ⚠️ <strong>PREVIEW</strong> — This page is not yet published. Review the content below, then approve to make it live.
    </p>
    <div style="display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
      <a href="${esc(approveUrl)}" style="
        display: inline-block; padding: 0.7rem 2rem;
        background: #c4a478; color: #0a0a0a;
        border-radius: 6px; text-decoration: none;
        font-family: 'Playfair Display', serif; font-size: 1rem;
        font-weight: 600; transition: background 0.3s;
      " onmouseover="this.style.background='#d4b488'" onmouseout="this.style.background='#c4a478'">
        ✅ Approve & Publish
      </a>
      <a href="mailto:hello@gentlytold.com?subject=Changes%20Requested%20-%20${encodeURIComponent(displayName)}&body=Memorial%20ID:%20${id}%0A%0APlease%20describe%20the%20changes%20you'd%20like:" style="
        display: inline-block; padding: 0.7rem 2rem;
        background: transparent; color: #c4a478;
        border: 1px solid rgba(196,164,120,0.4);
        border-radius: 6px; text-decoration: none;
        font-family: 'Playfair Display', serif; font-size: 1rem;
        transition: all 0.3s;
      " onmouseover="this.style.borderColor='#c4a478';this.style.background='rgba(196,164,120,0.1)'" onmouseout="this.style.borderColor='rgba(196,164,120,0.4)';this.style.background='transparent'">
        ✏️ Request Changes
      </a>
    </div>
  </div>
</div>
<div style="height: 110px;"></div>
`;

  const html = draft.html.replace('<body>', '<body>' + bannerHtml);

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

// ============================================================================
// GET/POST /api/approve/{id} — Validate token, publish, notify
// ============================================================================

async function handleApprove(id, url, env) {
  const token = url.searchParams.get('token');
  if (!token) {
    return new Response(errorPage('Missing Token', 'No approval token provided.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const draftJson = await env.PAGES.get(`draft:${id}`);
  if (!draftJson) {
    // Check if already published
    const published = await env.PAGES.get(`published:${id}`);
    if (published) {
      const pubData = JSON.parse(published);
      const permanentUrl = `${url.origin}/m/${id}`;
      return new Response(successPage(pubData.data?.name || 'Memorial', permanentUrl, true), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    return new Response(notFoundPage('Draft Not Found', 'This draft no longer exists. It may have already been published or expired.'), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const draft = JSON.parse(draftJson);

  if (draft.token !== token) {
    return new Response(errorPage('Invalid Token', 'The approval token does not match. Please use the link from your preview.'), {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Move from draft to published
  const published = {
    html: draft.html,
    data: draft.data,
    email: draft.email,
    funeralHomeName: draft.funeralHomeName,
    createdAt: draft.createdAt,
    publishedAt: new Date().toISOString(),
  };

  await env.PAGES.put(`published:${id}`, JSON.stringify(published));
  await env.PAGES.delete(`draft:${id}`);

  // Send Telegram notification
  const permanentUrl = `${url.origin}/m/${id}`;
  const displayName = draft.data?.name || 'Unknown';
  const funeralHome = draft.funeralHomeName || 'N/A';

  try {
    await sendTelegramNotification(env, displayName, funeralHome, permanentUrl);
  } catch (e) {
    console.error('Telegram notification failed:', e);
    // Don't fail the approval if notification fails
  }

  return new Response(successPage(displayName, permanentUrl, false), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ============================================================================
// GET /m/{id} — Serve published memorial
// ============================================================================

async function handlePublished(id, env) {
  const pubJson = await env.PAGES.get(`published:${id}`);
  if (!pubJson) {
    return new Response(notFoundPage('Memorial Not Found', 'This memorial page does not exist or has been removed.'), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const pub = JSON.parse(pubJson);

  return new Response(pub.html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}

// ============================================================================
// Telegram Notification
// ============================================================================

async function sendTelegramNotification(env, name, funeralHomeName, permanentUrl) {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID || '8169497922';

  if (!botToken) {
    console.error('TELEGRAM_BOT_TOKEN not set');
    return;
  }

  const message = `🎉 New memorial published!\n\n👤 ${name}\n🏛️ ${funeralHomeName}\n🔗 ${permanentUrl}`;

  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      disable_web_page_preview: false,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error('Telegram API error:', resp.status, err);
  }
}

// ============================================================================
// Helpers
// ============================================================================

function generateSlug(name, partnerName) {
  let base = name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);

  if (partnerName) {
    const partner = partnerName.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 20);
    // If they share a last name, use "first-first-last"
    const nameParts = name.split(/\s+/);
    const partnerParts = partnerName.split(/\s+/);
    if (nameParts.length > 1 && partnerParts.length > 1 &&
        nameParts[nameParts.length-1].toLowerCase() === partnerParts[partnerParts.length-1].toLowerCase()) {
      base = `${nameParts[0]}-${partnerParts[0]}-${nameParts[nameParts.length-1]}`.toLowerCase()
        .replace(/[^a-z0-9-]/g, '');
    } else {
      base = `${base}-${partner}`.slice(0, 50);
    }
  }

  // Add random suffix
  const suffix = crypto.randomUUID().slice(0, 4);
  return `${base}-${suffix}`;
}

function mapFormToPageData(body) {
  const isCouple = body.isCouple || false;
  const name = body.personName1 || body.name || '';
  const partnerName = isCouple ? (body.personName2 || '') : '';

  // Parse story into paragraphs
  const storyText = body.storyText || '';
  const storyParagraphs = storyText
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  // Map timeline items
  const timelineItems = (body.timelineItems || [])
    .filter(item => item.year || item.text || item.title)
    .map(item => ({
      year: item.year || '',
      title: item.title || item.text || '',
      description: item.description || '',
    }));

  // Map family members
  const familyMembers = (body.familyMembers || [])
    .filter(m => {
      if (typeof m === 'string') return m.trim().length > 0;
      return m && m.name && m.name.trim().length > 0;
    })
    .map(m => {
      if (typeof m === 'string') return { name: m, relationship: '' };
      return { name: m.name || '', relationship: m.relationship || '' };
    });

  return {
    name,
    partnerName,
    isCouple,
    birthDate: body.personBorn1 || body.birthDate || '',
    deathDate: body.personDied1 || body.deathDate || '',
    partnerBirthDate: isCouple ? (body.personBorn2 || '') : '',
    partnerDeathDate: isCouple ? (body.personDied2 || '') : '',
    heroQuote: body.heroQuote || '',
    heroQuoteAttribution: body.heroQuoteAttribution || '',
    storyParagraphs,
    timelineItems,
    photos: [],
    familyMembers,
    closingQuote: body.closingQuote || '',
    closingQuoteAttribution: body.closingQuoteAttribution || '',
    funeralHomeName: body.funeralHomeName || '',
    funeralHomeUrl: body.funeralHomeWebsite || body.funeralHomeUrl || '',
    funeralHomeLogo: '',
    memoryFormEnabled: true,
    customCss: '',
    heroImage: '',
    portraitImage: '',
    partnerPortraitImage: '',
  };
}

// ============================================================================
// Page Templates (Not Found, Error, Success)
// ============================================================================

function notFoundPage(title, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} — GentlyTold</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&family=Lato:wght@300;400&display=swap" rel="stylesheet">
<style>
  body { font-family: 'Lato', sans-serif; background: #0a0a0a; color: #e8e0d8; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
  .box { text-align: center; max-width: 500px; padding: 3rem 2rem; }
  h1 { font-family: 'Playfair Display', serif; color: #c4a478; font-size: 2rem; margin-bottom: 1rem; }
  p { font-weight: 300; color: rgba(232,224,216,0.7); line-height: 1.7; }
  a { color: #c4a478; text-decoration: none; }
</style>
</head>
<body>
<div class="box">
  <h1>${esc(title)}</h1>
  <p>${esc(message)}</p>
  <p style="margin-top: 2rem;"><a href="https://gentlytold.com">← Return to GentlyTold</a></p>
</div>
</body>
</html>`;
}

function errorPage(title, message) {
  return notFoundPage(title, message);
}

function successPage(displayName, permanentUrl, alreadyPublished) {
  const heading = alreadyPublished ? 'Already Published' : 'Memorial Published!';
  const intro = alreadyPublished
    ? 'This memorial has already been published. Here is the permanent link:'
    : `The memorial for <strong>${esc(displayName)}</strong> is now live. Share this permanent link with family and friends:`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(heading)} — GentlyTold</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Lato:wght@300;400&display=swap" rel="stylesheet">
<style>
  body { font-family: 'Lato', sans-serif; background: #0a0a0a; color: #e8e0d8; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 1rem; }
  .box { text-align: center; max-width: 600px; padding: 3rem 2rem; }
  .check { font-size: 4rem; margin-bottom: 1.5rem; }
  h1 { font-family: 'Playfair Display', serif; color: #c4a478; font-size: 2.5rem; margin-bottom: 1rem; }
  p { font-weight: 300; color: rgba(232,224,216,0.8); line-height: 1.7; margin-bottom: 1rem; }
  .link-box { background: rgba(196,164,120,0.08); border: 1px solid rgba(196,164,120,0.25); border-radius: 10px; padding: 1.5rem; margin: 2rem 0; }
  .link-box a { color: #c4a478; font-size: 1.1rem; word-break: break-all; text-decoration: none; }
  .link-box a:hover { text-decoration: underline; }
  .copy-btn { display: inline-block; margin-top: 1rem; padding: 0.6rem 1.5rem; background: #c4a478; color: #0a0a0a; border: none; border-radius: 6px; font-family: 'Lato', sans-serif; font-size: 0.9rem; cursor: pointer; font-weight: 600; }
  .copy-btn:hover { background: #d4b488; }
  .share-section { margin-top: 2rem; padding-top: 2rem; border-top: 1px solid rgba(196,164,120,0.15); }
  .share-section h3 { font-family: 'Playfair Display', serif; color: #c4a478; font-size: 1.2rem; margin-bottom: 0.5rem; }
  .share-section p { font-size: 0.9rem; color: rgba(232,224,216,0.6); }
  .view-btn { display: inline-block; margin-top: 1.5rem; padding: 0.8rem 2.5rem; background: transparent; color: #c4a478; border: 1px solid #c4a478; border-radius: 6px; text-decoration: none; font-family: 'Playfair Display', serif; font-size: 1rem; transition: all 0.3s; }
  .view-btn:hover { background: rgba(196,164,120,0.1); }
</style>
</head>
<body>
<div class="box">
  <div class="check">✦</div>
  <h1>${esc(heading)}</h1>
  <p>${intro}</p>
  
  <div class="link-box">
    <a href="${esc(permanentUrl)}" target="_blank" id="permLink">${esc(permanentUrl)}</a>
    <br>
    <button class="copy-btn" onclick="copyLink()">📋 Copy Link</button>
  </div>

  <a href="${esc(permanentUrl)}" class="view-btn" target="_blank">View Memorial →</a>

  <div class="share-section">
    <h3>Share This Memorial</h3>
    <p>Send the link above to family and friends. You can also generate a QR code at <a href="https://qrcode.tec-it.com/en/url?data=${encodeURIComponent(permanentUrl)}" target="_blank" style="color: #c4a478;">qrcode.tec-it.com</a> for printed programs or cards.</p>
    <p style="margin-top: 0.5rem;">Visitors can leave memories and tributes directly on the page.</p>
  </div>
</div>

<script>
function copyLink() {
  const link = document.getElementById('permLink').textContent;
  navigator.clipboard.writeText(link).then(() => {
    const btn = document.querySelector('.copy-btn');
    btn.textContent = '✓ Copied!';
    setTimeout(() => btn.textContent = '📋 Copy Link', 2000);
  });
}
</script>
</body>
</html>`;
}

// ============================================================================
// HTML Template Renderer (from existing worker)
// ============================================================================

function renderMemorialPage(data) {
  const {
    name = 'In Loving Memory',
    partnerName = '',
    isCouple = false,
    birthDate = '',
    deathDate = '',
    partnerBirthDate = '',
    partnerDeathDate = '',
    heroQuote = '',
    heroQuoteAttribution = '',
    storyParagraphs = [],
    timelineItems = [],
    photos = [],
    familyMembers = [],
    closingQuote = '',
    closingQuoteAttribution = '',
    funeralHomeName = '',
    funeralHomeUrl = '',
    funeralHomeLogo = '',
    memoryFormEnabled = true,
    customCss = '',
    heroImage = '',
    portraitImage = '',
    partnerPortraitImage = '',
  } = data;

  const displayName = isCouple && partnerName ? `${name} & ${partnerName}` : name;
  const dateDisplay = buildDateDisplay(data);
  const safeDisplayName = esc(displayName);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeDisplayName} — Memorial | GentlyTold</title>
<meta name="description" content="A memorial tribute to ${safeDisplayName}. Celebrating a life well lived.">
<meta property="og:title" content="${safeDisplayName} — Memorial">
<meta property="og:description" content="A memorial tribute to ${safeDisplayName}">
${heroImage ? `<meta property="og:image" content="${esc(heroImage)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Lato:wght@300;400;700&display=swap" rel="stylesheet">
<style>
/* ========== Reset & Base ========== */
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  font-family: 'Lato', sans-serif;
  font-weight: 300;
  background: #0a0a0a;
  color: #e8e0d8;
  line-height: 1.8;
  -webkit-font-smoothing: antialiased;
}
img { max-width: 100%; display: block; }
a { color: #c4a478; text-decoration: none; transition: color 0.3s; }
a:hover { color: #d4b88a; }

/* ========== Typography ========== */
h1, h2, h3, h4 { font-family: 'Playfair Display', serif; font-weight: 400; }
.section-title {
  font-size: clamp(1.5rem, 3vw, 2.2rem);
  color: #c4a478;
  text-align: center;
  margin-bottom: 2rem;
  letter-spacing: 0.03em;
}
.section-title::after {
  content: '';
  display: block;
  width: 60px;
  height: 1px;
  background: #c4a478;
  margin: 0.8rem auto 0;
}

/* ========== Layout ========== */
.container { max-width: 900px; margin: 0 auto; padding: 0 1.5rem; }
section { padding: 5rem 0; }
.divider {
  width: 40px;
  height: 1px;
  background: rgba(196, 164, 120, 0.4);
  margin: 0 auto;
}

/* ========== Hero ========== */
.hero {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  position: relative;
  overflow: hidden;
  padding: 4rem 1.5rem;
}
.hero::before {
  content: '';
  position: absolute;
  inset: 0;
  background: ${heroImage ? `url('${heroImage}') center/cover no-repeat` : 'linear-gradient(180deg, #0a0a0a 0%, #121210 50%, #0a0a0a 100%)'};
  opacity: ${heroImage ? '0.25' : '1'};
  z-index: 0;
}
.hero > * { position: relative; z-index: 1; }

.hero-portraits {
  display: flex;
  gap: 1.5rem;
  justify-content: center;
  margin-bottom: 2.5rem;
}
.portrait {
  width: 160px;
  height: 160px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid rgba(196, 164, 120, 0.5);
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
}

.hero h1 {
  font-size: clamp(2.2rem, 5vw, 4rem);
  color: #e8e0d8;
  letter-spacing: 0.04em;
  margin-bottom: 0.5rem;
  line-height: 1.2;
}
.hero-dates {
  font-size: 1.1rem;
  color: rgba(232, 224, 216, 0.6);
  letter-spacing: 0.15em;
  text-transform: uppercase;
  font-weight: 300;
  margin-bottom: 2rem;
}
.hero-quote {
  max-width: 600px;
  font-family: 'Playfair Display', serif;
  font-style: italic;
  font-size: clamp(1rem, 2vw, 1.25rem);
  color: rgba(196, 164, 120, 0.85);
  line-height: 1.7;
}
.hero-quote-attribution {
  margin-top: 0.5rem;
  font-family: 'Lato', sans-serif;
  font-style: normal;
  font-size: 0.85rem;
  color: rgba(196, 164, 120, 0.5);
}

/* ========== Story ========== */
.story p {
  font-size: 1.05rem;
  line-height: 2;
  margin-bottom: 1.5rem;
  color: rgba(232, 224, 216, 0.9);
}
.story p:first-of-type::first-letter {
  font-family: 'Playfair Display', serif;
  font-size: 3.5rem;
  float: left;
  line-height: 1;
  margin-right: 0.1em;
  color: #c4a478;
}

/* ========== Timeline ========== */
.timeline { position: relative; padding-left: 2rem; }
.timeline::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 1px;
  background: linear-gradient(180deg, transparent, #c4a478 10%, #c4a478 90%, transparent);
}
.timeline-item {
  position: relative;
  margin-bottom: 2.5rem;
  padding-left: 1.5rem;
}
.timeline-item::before {
  content: '';
  position: absolute;
  left: -2.35rem;
  top: 0.4rem;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c4a478;
  box-shadow: 0 0 12px rgba(196, 164, 120, 0.4);
}
.timeline-year {
  font-family: 'Playfair Display', serif;
  font-size: 0.9rem;
  color: #c4a478;
  letter-spacing: 0.1em;
  margin-bottom: 0.25rem;
}
.timeline-title {
  font-family: 'Playfair Display', serif;
  font-size: 1.15rem;
  color: #e8e0d8;
  margin-bottom: 0.3rem;
}
.timeline-desc {
  font-size: 0.95rem;
  color: rgba(232, 224, 216, 0.65);
}

/* ========== Gallery ========== */
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 1rem;
}
.gallery-item {
  aspect-ratio: 4/3;
  overflow: hidden;
  border-radius: 4px;
  cursor: pointer;
  position: relative;
}
.gallery-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.6s ease;
}
.gallery-item:hover img { transform: scale(1.05); }
.gallery-caption {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 1rem;
  background: linear-gradient(transparent, rgba(0,0,0,0.8));
  font-size: 0.85rem;
  color: rgba(232, 224, 216, 0.8);
  opacity: 0;
  transition: opacity 0.3s;
}
.gallery-item:hover .gallery-caption { opacity: 1; }

/* ========== Lightbox ========== */
.lightbox {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.95);
  z-index: 1000;
  justify-content: center;
  align-items: center;
  cursor: pointer;
}
.lightbox.active { display: flex; }
.lightbox img {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 4px;
}

/* ========== Memory Form ========== */
.memory-form {
  max-width: 600px;
  margin: 0 auto;
}
.memory-form textarea,
.memory-form input {
  width: 100%;
  background: rgba(232, 224, 216, 0.05);
  border: 1px solid rgba(196, 164, 120, 0.2);
  color: #e8e0d8;
  font-family: 'Lato', sans-serif;
  font-size: 1rem;
  padding: 0.9rem 1rem;
  border-radius: 4px;
  margin-bottom: 1rem;
  transition: border-color 0.3s;
}
.memory-form textarea:focus,
.memory-form input:focus {
  outline: none;
  border-color: #c4a478;
}
.memory-form textarea { min-height: 150px; resize: vertical; }
.memory-form button {
  background: transparent;
  color: #c4a478;
  border: 1px solid #c4a478;
  padding: 0.8rem 2.5rem;
  font-family: 'Lato', sans-serif;
  font-size: 0.9rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.3s;
  display: block;
  margin: 0 auto;
  border-radius: 4px;
}
.memory-form button:hover {
  background: #c4a478;
  color: #0a0a0a;
}

/* ========== Family ========== */
.family-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1.5rem;
  text-align: center;
}
.family-member {
  padding: 1.5rem 1rem;
  background: rgba(232, 224, 216, 0.03);
  border: 1px solid rgba(196, 164, 120, 0.1);
  border-radius: 4px;
}
.family-member-name {
  font-family: 'Playfair Display', serif;
  font-size: 1.1rem;
  color: #e8e0d8;
  margin-bottom: 0.25rem;
}
.family-member-relation {
  font-size: 0.85rem;
  color: #c4a478;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

/* ========== Closing Quote ========== */
.closing-quote {
  text-align: center;
  padding: 4rem 1.5rem;
}
.closing-quote blockquote {
  font-family: 'Playfair Display', serif;
  font-style: italic;
  font-size: clamp(1.1rem, 2.5vw, 1.5rem);
  color: rgba(196, 164, 120, 0.8);
  max-width: 700px;
  margin: 0 auto;
  line-height: 1.8;
}
.closing-quote .attribution {
  margin-top: 0.75rem;
  font-family: 'Lato', sans-serif;
  font-style: normal;
  font-size: 0.85rem;
  color: rgba(196, 164, 120, 0.45);
}

/* ========== Footer ========== */
footer {
  text-align: center;
  padding: 3rem 1.5rem;
  border-top: 1px solid rgba(196, 164, 120, 0.1);
}
.footer-funeral-home {
  margin-bottom: 1.5rem;
}
.footer-funeral-home img {
  max-height: 40px;
  margin: 0 auto 0.5rem;
  opacity: 0.7;
}
.footer-funeral-home-name {
  font-size: 0.85rem;
  color: rgba(232, 224, 216, 0.5);
  letter-spacing: 0.05em;
}
.footer-brand {
  font-size: 0.75rem;
  color: rgba(232, 224, 216, 0.25);
  letter-spacing: 0.08em;
}
.footer-brand a { color: rgba(196, 164, 120, 0.4); }
.footer-brand a:hover { color: rgba(196, 164, 120, 0.7); }

/* ========== Animations ========== */
.fade-in {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.8s ease, transform 0.8s ease;
}
.fade-in.visible {
  opacity: 1;
  transform: translateY(0);
}

/* ========== Responsive ========== */
@media (max-width: 600px) {
  .portrait { width: 120px; height: 120px; }
  .hero-portraits { gap: 1rem; }
  section { padding: 3.5rem 0; }
  .timeline { padding-left: 1.5rem; }
  .gallery-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
  .family-grid { grid-template-columns: 1fr 1fr; }
}

${customCss ? customCss : ''}
</style>
</head>
<body>

<!-- ==================== Hero ==================== -->
<section class="hero">
  ${(portraitImage || partnerPortraitImage) ? `
  <div class="hero-portraits">
    ${portraitImage ? `<img src="${esc(portraitImage)}" alt="${esc(name)}" class="portrait">` : ''}
    ${isCouple && partnerPortraitImage ? `<img src="${esc(partnerPortraitImage)}" alt="${esc(partnerName)}" class="portrait">` : ''}
  </div>` : ''}
  <h1>${safeDisplayName}</h1>
  <p class="hero-dates">${esc(dateDisplay)}</p>
  ${heroQuote ? `
  <div class="hero-quote">
    <p>\u201C${esc(heroQuote)}\u201D</p>
    ${heroQuoteAttribution ? `<p class="hero-quote-attribution">\u2014 ${esc(heroQuoteAttribution)}</p>` : ''}
  </div>` : ''}
</section>

<div class="divider"></div>

<!-- ==================== Story ==================== -->
${storyParagraphs.length > 0 ? `
<section class="story fade-in">
  <div class="container">
    <h2 class="section-title">${isCouple ? 'Their Story' : 'A Life Remembered'}</h2>
    ${storyParagraphs.map(p => `<p>${esc(p)}</p>`).join('\n    ')}
  </div>
</section>
<div class="divider"></div>` : ''}

<!-- ==================== Timeline ==================== -->
${timelineItems.length > 0 ? `
<section class="fade-in">
  <div class="container">
    <h2 class="section-title">Life\u2019s Journey</h2>
    <div class="timeline">
      ${timelineItems.map(item => `
      <div class="timeline-item">
        <div class="timeline-year">${esc(item.year || '')}</div>
        <div class="timeline-title">${esc(item.title || '')}</div>
        ${item.description ? `<div class="timeline-desc">${esc(item.description)}</div>` : ''}
      </div>`).join('')}
    </div>
  </div>
</section>
<div class="divider"></div>` : ''}

<!-- ==================== Gallery ==================== -->
${photos.length > 0 ? `
<section class="fade-in">
  <div class="container">
    <h2 class="section-title">Cherished Moments</h2>
    <div class="gallery-grid">
      ${photos.map((photo, i) => `
      <div class="gallery-item" onclick="openLightbox('${esc(photo.url || photo)}')">
        <img src="${esc(photo.url || photo)}" alt="${esc(photo.caption || `Photo ${i + 1}`)}" loading="lazy">
        ${photo.caption ? `<div class="gallery-caption">${esc(photo.caption)}</div>` : ''}
      </div>`).join('')}
    </div>
  </div>
</section>
<div class="divider"></div>` : ''}

<!-- ==================== Share a Memory ==================== -->
${memoryFormEnabled ? `
<section class="fade-in">
  <div class="container">
    <h2 class="section-title">Share a Memory</h2>
    <form class="memory-form" id="memoryForm" onsubmit="submitMemory(event)">
      <input type="text" name="authorName" placeholder="Your name" required>
      <input type="text" name="relationship" placeholder="Your relationship (e.g., friend, neighbor, coworker)">
      <textarea name="memory" placeholder="Share your favorite memory or what ${esc(name)} meant to you..." required></textarea>
      <button type="submit">Share Memory</button>
    </form>
    <div id="memoryConfirmation" style="display:none; text-align:center; color:#c4a478; margin-top:1.5rem;">
      <p>Thank you for sharing your memory. It means the world to the family.</p>
    </div>
  </div>
</section>
<div class="divider"></div>` : ''}

<!-- ==================== Family ==================== -->
${familyMembers.length > 0 ? `
<section class="fade-in">
  <div class="container">
    <h2 class="section-title">${isCouple ? 'Their Family' : 'Family'}</h2>
    <div class="family-grid">
      ${familyMembers.map(member => `
      <div class="family-member">
        <div class="family-member-name">${esc(member.name || '')}</div>
        <div class="family-member-relation">${esc(member.relationship || '')}</div>
      </div>`).join('')}
    </div>
  </div>
</section>` : ''}

<!-- ==================== Closing Quote ==================== -->
${closingQuote ? `
<section class="closing-quote fade-in">
  <blockquote>
    <p>\u201C${esc(closingQuote)}\u201D</p>
    ${closingQuoteAttribution ? `<p class="attribution">\u2014 ${esc(closingQuoteAttribution)}</p>` : ''}
  </blockquote>
</section>` : ''}

<!-- ==================== Footer ==================== -->
<footer>
  ${funeralHomeName ? `
  <div class="footer-funeral-home">
    ${funeralHomeLogo ? `<img src="${esc(funeralHomeLogo)}" alt="${esc(funeralHomeName)}">` : ''}
    <p class="footer-funeral-home-name">${funeralHomeUrl ? `<a href="${esc(funeralHomeUrl)}" target="_blank" rel="noopener">${esc(funeralHomeName)}</a>` : esc(funeralHomeName)}</p>
  </div>` : ''}
  <p class="footer-brand">Created with care by <a href="https://gentlytold.com" target="_blank" rel="noopener">GentlyTold</a></p>
</footer>

<!-- ==================== Lightbox ==================== -->
<div class="lightbox" id="lightbox" onclick="closeLightbox()">
  <img id="lightboxImg" src="" alt="Photo">
</div>

<!-- ==================== Scripts ==================== -->
<script>
// Intersection observer for fade-in
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });
document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));

// Lightbox
function openLightbox(src) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightbox').classList.add('active');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('active');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

// Memory form
function submitMemory(e) {
  e.preventDefault();
  const form = e.target;
  form.style.display = 'none';
  document.getElementById('memoryConfirmation').style.display = 'block';
}
</script>

</body>
</html>`;
}

// ============================================================================
// Utility: HTML escape
// ============================================================================

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================================
// Utility: Build display date string
// ============================================================================

function buildDateDisplay(data) {
  const { birthDate, deathDate, isCouple, partnerBirthDate, partnerDeathDate, name, partnerName } = data;

  if (isCouple && partnerName) {
    const p1 = [birthDate, deathDate].filter(Boolean).join(' \u2013 ');
    const p2 = [partnerBirthDate, partnerDeathDate].filter(Boolean).join(' \u2013 ');
    if (p1 && p2) return `${name}: ${p1}  \u00B7  ${partnerName}: ${p2}`;
    if (p1) return p1;
    if (p2) return p2;
    return '';
  }

  return [birthDate, deathDate].filter(Boolean).join(' \u2013 ');
}
