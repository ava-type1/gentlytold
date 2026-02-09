// ============================================================================
// GentlyTold.com — Memorial Pages API Worker
// Cloudflare Worker with R2 storage and Claude AI generation
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
      // Health check — no auth required
      if (path === '/api/health' && request.method === 'GET') {
        return corsResponse(Response.json({ status: 'ok', service: 'gentlytold-api', timestamp: new Date().toISOString() }));
      }

      // Auth check for all other endpoints
      const authError = checkAuth(request, env);
      if (authError) return corsResponse(authError);

      // Route
      if (path === '/api/generate' && request.method === 'POST') {
        return corsResponse(await handleGenerate(request, env));
      }
      if (path === '/api/upload' && request.method === 'POST') {
        return corsResponse(await handleUpload(request, env));
      }
      if (path === '/api/build' && request.method === 'POST') {
        return corsResponse(await handleBuild(request, env));
      }

      return corsResponse(Response.json({ error: 'Not found' }, { status: 404 }));
    } catch (err) {
      console.error('Unhandled error:', err);
      return corsResponse(Response.json({ error: 'Internal server error', message: err.message }, { status: 500 }));
    }
  }
};

// ============================================================================
// Auth
// ============================================================================

function checkAuth(request, env) {
  const apiKey = request.headers.get('X-API-Key');
  if (!apiKey || apiKey !== env.API_KEY) {
    return Response.json({ error: 'Unauthorized — missing or invalid X-API-Key' }, { status: 401 });
  }
  return null;
}

// ============================================================================
// CORS
// ============================================================================

function corsResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// ============================================================================
// POST /api/generate — AI narrative generation via Claude
// ============================================================================

async function handleGenerate(request, env) {
  const body = await request.json();
  const { name, birthDate, deathDate, familyMembers, obituaryText, timelineEvents, quote, isCouple, partnerName } = body;

  if (!name) {
    return Response.json({ error: 'Missing required field: name' }, { status: 400 });
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({ name, birthDate, deathDate, familyMembers, obituaryText, timelineEvents, quote, isCouple, partnerName });

  const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!claudeResponse.ok) {
    const errText = await claudeResponse.text();
    console.error('Claude API error:', claudeResponse.status, errText);
    return Response.json({ error: 'AI generation failed', detail: errText }, { status: 502 });
  }

  const claudeData = await claudeResponse.json();
  const rawText = claudeData.content?.[0]?.text || '';

  // Extract JSON from Claude's response (may be wrapped in markdown fences)
  let generated;
  try {
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/) || rawText.match(/(\{[\s\S]*\})/);
    generated = JSON.parse(jsonMatch[1]);
  } catch (parseErr) {
    console.error('Failed to parse Claude response:', rawText);
    return Response.json({ error: 'Failed to parse AI response', raw: rawText }, { status: 502 });
  }

  return Response.json({
    success: true,
    data: generated,
    usage: claudeData.usage,
  });
}

// ============================================================================
// Claude system prompt — the heart of narrative generation
// ============================================================================

function buildSystemPrompt() {
  return `You are a compassionate memorial writer for GentlyTold.com, a platform that creates beautiful, dignified online memorial pages for families honoring their loved ones.

Your role is to transform raw obituary information, family details, and life events into a warm, eloquent, and deeply personal life narrative. You write with the reverence of a eulogy, the intimacy of a family letter, and the polish of fine literary prose.

VOICE & TONE:
- Warm but not saccharine. Dignified but not stiff.
- Write as though speaking to someone who loved this person deeply.
- Honor the specific, concrete details — a person's life lives in the particulars.
- Vary sentence rhythm. Mix longer reflective passages with shorter, poignant lines.
- Avoid clichés like "passed away peacefully," "left this world," or "gone too soon" unless the family specifically used them. Find fresher, more personal language.
- When details are sparse, write gracefully around gaps — never fabricate.

OUTPUT FORMAT — Return ONLY valid JSON with this exact structure:
{
  "storyParagraphs": [
    "First paragraph — the opening. Set the scene of who this person was at their core.",
    "Second paragraph — early life, upbringing, formative years.",
    "Third paragraph — career, passions, what they built or contributed.",
    "Fourth paragraph — love, family, relationships, community.",
    "Fifth paragraph — legacy, what they leave behind, closing reflection."
  ],
  "timelineItems": [
    { "year": "1945", "title": "Born in Springfield", "description": "A brief, warm description of this milestone." }
  ],
  "heroQuote": "A single quote for the hero section — either from the person, about the person, or a fitting literary/spiritual quote. Attribute if possible.",
  "closingQuote": "A different quote for the closing section — reflective, about memory or legacy."
}

RULES:
- storyParagraphs: Generate 3–6 paragraphs depending on how much source material is provided. Each should be a substantive paragraph (3–5 sentences minimum).
- timelineItems: Refine the provided timeline events. Clean up language, add warmth. Include 4–12 items depending on source material. Always include birth and death.
- heroQuote: If the family provided a quote, use it (polish lightly if needed). If not, select something fitting — prefer lesser-known quotes that feel personal rather than generic.
- closingQuote: Always provide this. Something about memory, legacy, or the endurance of love.
- For couples: Weave their story together. Honor both individuals while celebrating their shared journey.
- Return ONLY the JSON object — no markdown fences, no preamble, no commentary.`;
}

function buildUserPrompt({ name, birthDate, deathDate, familyMembers, obituaryText, timelineEvents, quote, isCouple, partnerName }) {
  let prompt = `Please write a memorial narrative for the following:\n\n`;

  if (isCouple && partnerName) {
    prompt += `TYPE: Couple memorial\nNAMES: ${name} & ${partnerName}\n`;
  } else {
    prompt += `NAME: ${name}\n`;
  }

  if (birthDate) prompt += `BORN: ${birthDate}\n`;
  if (deathDate) prompt += `DIED: ${deathDate}\n`;

  if (familyMembers && familyMembers.length > 0) {
    prompt += `\nFAMILY:\n`;
    for (const member of familyMembers) {
      prompt += `- ${member.relationship}: ${member.name}${member.note ? ` (${member.note})` : ''}\n`;
    }
  }

  if (quote) {
    prompt += `\nFAMILY-PROVIDED QUOTE: "${quote}"\n`;
  }

  if (timelineEvents && timelineEvents.length > 0) {
    prompt += `\nTIMELINE EVENTS:\n`;
    for (const event of timelineEvents) {
      prompt += `- ${event.year}: ${event.title}${event.description ? ' — ' + event.description : ''}\n`;
    }
  }

  if (obituaryText) {
    prompt += `\nOBITUARY / LIFE STORY TEXT:\n${obituaryText}\n`;
  }

  prompt += `\nGenerate the memorial content as specified. Return only valid JSON.`;
  return prompt;
}

// ============================================================================
// POST /api/upload — Photo upload to R2
// ============================================================================

async function handleUpload(request, env) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const formData = await request.formData();
  const slug = formData.get('slug');
  if (!slug) {
    return Response.json({ error: 'Missing required field: slug (memorial identifier)' }, { status: 400 });
  }

  // Sanitize slug
  const safeSlug = slug.toString().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 64);

  const uploadedFiles = [];
  let photoIndex = 0;

  for (const [key, value] of formData.entries()) {
    if (key === 'slug') continue;
    if (!(value instanceof File)) continue;

    const file = value;
    const ext = getExtension(file.name, file.type);
    const objectKey = `${safeSlug}/photo-${photoIndex + 1}${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    await env.MEMORIAL_PHOTOS.put(objectKey, arrayBuffer, {
      httpMetadata: { contentType: file.type },
      customMetadata: { originalName: file.name, uploadedAt: new Date().toISOString() },
    });

    uploadedFiles.push({
      key: objectKey,
      url: `/photos/${objectKey}`,
      originalName: file.name,
      size: file.size,
      type: file.type,
    });

    photoIndex++;
  }

  if (photoIndex === 0) {
    return Response.json({ error: 'No files found in upload' }, { status: 400 });
  }

  return Response.json({
    success: true,
    slug: safeSlug,
    files: uploadedFiles,
    count: photoIndex,
  });
}

function getExtension(filename, mimeType) {
  const fromName = filename?.match(/\.[a-zA-Z0-9]+$/)?.[0]?.toLowerCase();
  if (fromName) return fromName;
  const mimeMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
  return mimeMap[mimeType] || '.jpg';
}

// ============================================================================
// POST /api/build — Assemble final HTML memorial page
// ============================================================================

async function handleBuild(request, env) {
  const data = await request.json();

  if (!data.name) {
    return Response.json({ error: 'Missing required field: name' }, { status: 400 });
  }

  const html = renderMemorialPage(data);

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

// ============================================================================
// HTML Template Renderer
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
    <p>"${esc(heroQuote)}"</p>
    ${heroQuoteAttribution ? `<p class="hero-quote-attribution">— ${esc(heroQuoteAttribution)}</p>` : ''}
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
    <h2 class="section-title">Life's Journey</h2>
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
    <p>"${esc(closingQuote)}"</p>
    ${closingQuoteAttribution ? `<p class="attribution">— ${esc(closingQuoteAttribution)}</p>` : ''}
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
  // In production, this would POST to an API endpoint
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
    const p1 = [birthDate, deathDate].filter(Boolean).join(' – ');
    const p2 = [partnerBirthDate, partnerDeathDate].filter(Boolean).join(' – ');
    if (p1 && p2) return `${name}: ${p1}  ·  ${partnerName}: ${p2}`;
    if (p1) return p1;
    if (p2) return p2;
    return '';
  }

  return [birthDate, deathDate].filter(Boolean).join(' – ');
}
