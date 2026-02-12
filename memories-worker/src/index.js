/**
 * GentlyTold — Memories API Worker
 * Stores and serves shared memories (with optional photos) for memorial pages
 * Uses Cloudflare KV for storage
 * 
 * Storage model:
 *   memories:{slug}  — array of APPROVED memories (public)
 *   pending:{slug}   — array of memories awaiting approval
 *   admin:{slug}     — { token, email, name } for family contact
 *   photo:{key}      — base64 photo data
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      return await handleRequest(request, env, url, corsHeaders);
    } catch (e) {
      return jsonResponse({ error: 'Internal server error', detail: e.message }, 500, corsHeaders);
    }
  },
};

async function handleRequest(request, env, url, corsHeaders) {
  const { method } = request;
  const path = url.pathname;

  // ─── GET /api/photo/:key — Serve a stored photo ───
  if (method === 'GET' && path.startsWith('/api/photo/')) {
    const key = path.replace('/api/photo/', '');
    if (!key) return jsonResponse({ error: 'Missing key' }, 400, corsHeaders);

    const photoData = await env.MEMORIES.get(`photo:${key}`);
    if (!photoData) return new Response('Not found', { status: 404, headers: corsHeaders });

    const parsed = JSON.parse(photoData);
    const binary = Uint8Array.from(atob(parsed.data), c => c.charCodeAt(0));

    return new Response(binary, {
      headers: {
        ...corsHeaders,
        'Content-Type': parsed.type || 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  }

  // ─── GET /api/review/:slug?token=xxx — HTML review page ───
  if (method === 'GET' && path.match(/^\/api\/review\/[^/]+$/)) {
    const slug = path.split('/')[3];
    const token = url.searchParams.get('token');
    if (!slug || !token) return htmlResponse(errorPage('Missing slug or token'), 400);

    const admin = await env.MEMORIES.get(`admin:${slug}`, 'json');
    if (!admin || admin.token !== token) return htmlResponse(errorPage('Invalid or expired review link'), 403);

    const pending = await env.MEMORIES.get(`pending:${slug}`, 'json') || [];
    const workerUrl = url.origin;
    return htmlResponse(reviewPage(slug, token, pending, workerUrl));
  }

  // ─── POST /api/memories/:slug — Submit a memory (goes to PENDING) ───
  if (method === 'POST' && path.match(/^\/api\/memories\/[^/]+$/)) {
    const slug = path.split('/')[3];
    if (!slug) return jsonResponse({ error: 'Missing memorial slug' }, 400, corsHeaders);

    const formData = await request.formData();
    const id = crypto.randomUUID();

    const memory = {
      id,
      name: formData.get('name')?.trim() || 'Anonymous',
      relationship: formData.get('relationship')?.trim() || '',
      memory: formData.get('memory')?.trim() || '',
      date: new Date().toISOString(),
    };

    if (!memory.memory) {
      return jsonResponse({ error: 'Memory text is required' }, 400, corsHeaders);
    }

    // Handle photo upload
    const photo = formData.get('photo');
    if (photo && photo.size > 0) {
      if (photo.size > 5 * 1024 * 1024) {
        return jsonResponse({ error: 'Photo must be under 5MB' }, 400, corsHeaders);
      }

      const photoKey = `${slug}-${id}`;
      const arrayBuf = await photo.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));

      await env.MEMORIES.put(`photo:${photoKey}`, JSON.stringify({
        type: photo.type || 'image/jpeg',
        data: base64,
      }));

      memory.photoUrl = `/api/photo/${photoKey}`;
    }

    // Add to pending queue
    const pending = await env.MEMORIES.get(`pending:${slug}`, 'json') || [];
    pending.push(memory);
    await env.MEMORIES.put(`pending:${slug}`, JSON.stringify(pending));

    // Send Telegram notification
    await sendTelegramNotification(env, slug, memory);

    return jsonResponse({ success: true, message: 'Memory submitted for review' }, 200, corsHeaders);
  }

  // ─── GET /api/memories/:slug — Get APPROVED memories (public) ───
  if (method === 'GET' && path.match(/^\/api\/memories\/[^/]+$/)) {
    const slug = path.split('/')[3];
    if (!slug) return jsonResponse({ error: 'Missing memorial slug' }, 400, corsHeaders);

    const memories = await env.MEMORIES.get(`memories:${slug}`, 'json') || [];
    return jsonResponse(memories, 200, corsHeaders);
  }

  // ─── GET /api/pending/:slug?token=xxx — Get pending memories (admin) ───
  if (method === 'GET' && path.match(/^\/api\/pending\/[^/]+$/)) {
    const slug = path.split('/')[3];
    const token = url.searchParams.get('token');

    const authError = await validateAdminToken(env, slug, token);
    if (authError) return jsonResponse({ error: authError }, 403, corsHeaders);

    const pending = await env.MEMORIES.get(`pending:${slug}`, 'json') || [];
    return jsonResponse(pending, 200, corsHeaders);
  }

  // ─── POST /api/approve/:slug/:memoryId?token=xxx — Approve a pending memory ───
  if (method === 'POST' && path.match(/^\/api\/approve\/[^/]+\/[^/]+$/)) {
    const parts = path.split('/');
    const slug = parts[3];
    const memoryId = parts[4];
    const token = url.searchParams.get('token');

    const authError = await validateAdminToken(env, slug, token);
    if (authError) return jsonResponse({ error: authError }, 403, corsHeaders);

    const pending = await env.MEMORIES.get(`pending:${slug}`, 'json') || [];
    const idx = pending.findIndex(m => m.id === memoryId);
    if (idx === -1) return jsonResponse({ error: 'Memory not found in pending queue' }, 404, corsHeaders);

    // Remove from pending, add to approved
    const [memory] = pending.splice(idx, 1);
    const approved = await env.MEMORIES.get(`memories:${slug}`, 'json') || [];

    // Guard against duplicate approvals
    if (approved.some(m => m.id === memoryId)) {
      await env.MEMORIES.put(`pending:${slug}`, JSON.stringify(pending));
      return jsonResponse({ error: 'Memory already approved' }, 409, corsHeaders);
    }

    approved.push(memory);

    await env.MEMORIES.put(`pending:${slug}`, JSON.stringify(pending));
    await env.MEMORIES.put(`memories:${slug}`, JSON.stringify(approved));

    return jsonResponse({ success: true, message: 'Memory approved', remaining: pending.length }, 200, corsHeaders);
  }

  // ─── POST /api/reject/:slug/:memoryId?token=xxx — Reject a pending memory ───
  if (method === 'POST' && path.match(/^\/api\/reject\/[^/]+\/[^/]+$/)) {
    const parts = path.split('/');
    const slug = parts[3];
    const memoryId = parts[4];
    const token = url.searchParams.get('token');

    const authError = await validateAdminToken(env, slug, token);
    if (authError) return jsonResponse({ error: authError }, 403, corsHeaders);

    const pending = await env.MEMORIES.get(`pending:${slug}`, 'json') || [];
    const idx = pending.findIndex(m => m.id === memoryId);
    if (idx === -1) return jsonResponse({ error: 'Memory not found in pending queue' }, 404, corsHeaders);

    const [rejected] = pending.splice(idx, 1);

    // Clean up associated photo if any
    if (rejected.photoUrl) {
      const photoKey = rejected.photoUrl.replace('/api/photo/', '');
      await env.MEMORIES.delete(`photo:${photoKey}`);
    }

    await env.MEMORIES.put(`pending:${slug}`, JSON.stringify(pending));

    return jsonResponse({ success: true, message: 'Memory rejected', remaining: pending.length }, 200, corsHeaders);
  }

  // ─── POST /api/admin/:slug — Set up admin for a memorial (master key required) ───
  if (method === 'POST' && path.match(/^\/api\/admin\/[^/]+$/)) {
    const slug = path.split('/')[3];
    const masterKey = request.headers.get('X-Admin-Key');

    if (!masterKey || masterKey !== env.MASTER_ADMIN_KEY) {
      return jsonResponse({ error: 'Invalid admin key' }, 403, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders);
    }

    const token = crypto.randomUUID();
    const admin = {
      token,
      email: body.email || '',
      name: body.name || '',
      createdAt: new Date().toISOString(),
    };

    await env.MEMORIES.put(`admin:${slug}`, JSON.stringify(admin));

    const reviewUrl = `${url.origin}/api/review/${slug}?token=${token}`;

    return jsonResponse({
      success: true,
      token,
      reviewUrl,
      message: `Admin set up for memorial "${slug}". Share the review URL with the family contact.`,
    }, 200, corsHeaders);
  }

  return new Response('Not found', { status: 404, headers: corsHeaders });
}

// ─── Helpers ───

function jsonResponse(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html;charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function validateAdminToken(env, slug, token) {
  if (!token) return 'Missing token';
  const admin = await env.MEMORIES.get(`admin:${slug}`, 'json');
  if (!admin) return 'No admin configured for this memorial';
  if (admin.token !== token) return 'Invalid token';
  return null; // valid
}

async function sendTelegramNotification(env, slug, memory) {
  if (!env.TELEGRAM_BOT_TOKEN) return;

  const chatId = '8169497922';
  const reviewUrl = `https://gentlytold-memories.kameronmartinllc.workers.dev/api/review/${slug}`;

  // Try to get admin token for deep link
  const admin = await env.MEMORIES.get(`admin:${slug}`, 'json');
  const fullReviewUrl = admin ? `${reviewUrl}?token=${admin.token}` : reviewUrl;

  const text = [
    `🕊 *New Memory Submitted*`,
    ``,
    `*Memorial:* ${escapeMarkdown(slug)}`,
    `*From:* ${escapeMarkdown(memory.name)}`,
    memory.relationship ? `*Relationship:* ${escapeMarkdown(memory.relationship)}` : null,
    ``,
    `_"${escapeMarkdown(memory.memory.substring(0, 200))}${memory.memory.length > 200 ? '...' : ''}"_`,
    ``,
    `[Review pending memories](${fullReviewUrl})`,
  ].filter(Boolean).join('\n');

  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });
  } catch (e) {
    // Don't fail the request if notification fails
    console.error('Telegram notification failed:', e);
  }
}

function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// ─── Review Page HTML ───

function errorPage(message) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Error — GentlyTold</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&family=Lato:wght@300;400&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Lato', sans-serif; background: #0a0a0a; color: #e8e0d8; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .error { text-align: center; padding: 3rem; }
  .error h1 { font-family: 'Playfair Display', serif; color: #c4a478; font-size: 1.5rem; margin-bottom: 1rem; }
  .error p { color: #7a7068; font-weight: 300; }
</style>
</head><body>
<div class="error">
  <h1>✦</h1>
  <h1>${message}</h1>
  <p>Please check the link and try again.</p>
</div>
</body></html>`;
}

function reviewPage(slug, token, pending, workerUrl) {
  const count = pending.length;
  const memoriesHtml = pending.map(m => `
    <div class="memory-card" id="memory-${m.id}" data-id="${m.id}">
      ${m.photoUrl ? `<div class="memory-photo"><img src="${workerUrl}${m.photoUrl}" alt="Photo from ${escapeHtml(m.name)}" loading="lazy"></div>` : ''}
      <div class="memory-content">
        <div class="memory-text">"${escapeHtml(m.memory)}"</div>
        <div class="memory-meta">
          <span class="memory-author">— ${escapeHtml(m.name)}</span>
          ${m.relationship ? `<span class="memory-rel">${escapeHtml(m.relationship)}</span>` : ''}
          <span class="memory-date">${new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </div>
      </div>
      <div class="memory-actions">
        <button class="btn btn-approve" onclick="handleAction('approve', '${m.id}', this)" title="Approve">
          <span class="btn-icon">✓</span> Approve
        </button>
        <button class="btn btn-reject" onclick="handleAction('reject', '${m.id}', this)" title="Reject">
          <span class="btn-icon">✗</span> Reject
        </button>
      </div>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Review Memories — GentlyTold</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Lato:wght@300;400;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Lato', sans-serif;
    background: #0a0a0a;
    color: #e8e0d8;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }
  a { color: #c4a478; text-decoration: none; }

  .header {
    text-align: center;
    padding: 3rem 1.5rem 2rem;
    background: linear-gradient(180deg, #0a0a0a 0%, #1a1510 50%, #0a0a0a 100%);
    position: relative;
  }
  .header::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: radial-gradient(ellipse at center, rgba(196,164,120,0.06) 0%, transparent 70%);
    pointer-events: none;
  }
  .ornament {
    font-size: 1.5rem;
    color: #c4a478;
    letter-spacing: 0.5rem;
    opacity: 0.6;
    margin-bottom: 1rem;
  }
  .header h1 {
    font-family: 'Playfair Display', serif;
    font-size: clamp(1.5rem, 4vw, 2.2rem);
    font-weight: 400;
    color: #f5efe8;
    margin-bottom: 0.5rem;
  }
  .header .slug-name {
    font-family: 'Playfair Display', serif;
    font-size: 1rem;
    color: #c4a478;
    font-style: italic;
    margin-bottom: 0.75rem;
  }
  .count-badge {
    display: inline-block;
    background: rgba(196,164,120,0.15);
    border: 1px solid rgba(196,164,120,0.3);
    border-radius: 20px;
    padding: 0.4rem 1.2rem;
    font-size: 0.9rem;
    color: #c4a478;
  }

  .container {
    max-width: 700px;
    margin: 0 auto;
    padding: 1.5rem 1.5rem 4rem;
  }

  .empty-state {
    text-align: center;
    padding: 4rem 2rem;
  }
  .empty-state .icon { font-size: 3rem; margin-bottom: 1rem; opacity: 0.5; }
  .empty-state h2 {
    font-family: 'Playfair Display', serif;
    font-size: 1.3rem;
    font-weight: 400;
    color: #a89880;
    margin-bottom: 0.5rem;
  }
  .empty-state p { color: #5a5450; font-weight: 300; }

  .memory-card {
    background: rgba(196,164,120,0.04);
    border: 1px solid rgba(196,164,120,0.12);
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 1.25rem;
    transition: all 0.4s ease;
    overflow: hidden;
  }
  .memory-card.removing {
    opacity: 0;
    transform: translateX(100px) scale(0.95);
    max-height: 0;
    padding: 0 1.5rem;
    margin-bottom: 0;
    border-color: transparent;
  }
  .memory-card.approved {
    border-color: rgba(100,180,100,0.4);
    background: rgba(100,180,100,0.06);
  }
  .memory-card.rejected {
    border-color: rgba(180,80,80,0.4);
    background: rgba(180,80,80,0.06);
  }

  .memory-photo {
    margin-bottom: 1rem;
    border-radius: 8px;
    overflow: hidden;
    max-height: 300px;
  }
  .memory-photo img {
    width: 100%;
    height: auto;
    max-height: 300px;
    object-fit: cover;
    display: block;
  }

  .memory-text {
    font-weight: 300;
    color: #d4ccc4;
    line-height: 1.8;
    font-style: italic;
    margin-bottom: 1rem;
    font-size: 1.05rem;
    word-break: break-word;
  }

  .memory-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    align-items: center;
    margin-bottom: 1.25rem;
    font-size: 0.85rem;
  }
  .memory-author { color: #c4a478; font-weight: 400; }
  .memory-rel {
    color: #7a7068;
    font-weight: 300;
    padding-left: 1rem;
    border-left: 1px solid rgba(196,164,120,0.2);
  }
  .memory-date { color: #4a4440; font-weight: 300; }

  .memory-actions {
    display: flex;
    gap: 0.75rem;
  }

  .btn {
    flex: 1;
    padding: 0.75rem 1rem;
    border: 1px solid;
    border-radius: 8px;
    font-family: 'Lato', sans-serif;
    font-size: 0.95rem;
    font-weight: 400;
    cursor: pointer;
    transition: all 0.25s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-icon { font-size: 1.1rem; font-weight: 700; }

  .btn-approve {
    background: rgba(100,180,100,0.08);
    border-color: rgba(100,180,100,0.35);
    color: #7ac47a;
  }
  .btn-approve:hover:not(:disabled) {
    background: rgba(100,180,100,0.18);
    border-color: rgba(100,180,100,0.6);
  }

  .btn-reject {
    background: rgba(180,80,80,0.08);
    border-color: rgba(180,80,80,0.35);
    color: #c47a7a;
  }
  .btn-reject:hover:not(:disabled) {
    background: rgba(180,80,80,0.18);
    border-color: rgba(180,80,80,0.6);
  }

  .toast {
    position: fixed;
    bottom: 2rem;
    left: 50%;
    transform: translateX(-50%) translateY(100px);
    background: #1a1510;
    border: 1px solid rgba(196,164,120,0.3);
    border-radius: 10px;
    padding: 0.75rem 1.5rem;
    font-size: 0.9rem;
    color: #e8e0d8;
    opacity: 0;
    transition: all 0.35s ease;
    z-index: 100;
    pointer-events: none;
  }
  .toast.visible {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }

  .footer {
    text-align: center;
    padding: 2rem;
    border-top: 1px solid rgba(196,164,120,0.08);
  }
  .footer p { font-size: 0.75rem; color: #4a4440; }
  .footer a { color: #5a5450; }
  .footer a:hover { color: #c4a478; }

  @media (max-width: 500px) {
    .header { padding: 2.5rem 1.25rem 1.5rem; }
    .container { padding: 1rem 1rem 3rem; }
    .memory-card { padding: 1.25rem; }
    .btn { padding: 0.65rem 0.75rem; font-size: 0.85rem; }
  }
</style>
</head>
<body>

<div class="header">
  <div class="ornament">✦ ✦ ✦</div>
  <h1>Review Memories</h1>
  <div class="slug-name">${escapeHtml(slug)} memorial</div>
  <div class="count-badge" id="countBadge">${count} ${count === 1 ? 'memory' : 'memories'} waiting for review</div>
</div>

<div class="container">
  ${count === 0 ? `
  <div class="empty-state" id="emptyState">
    <div class="icon">✦</div>
    <h2>All caught up</h2>
    <p>No memories waiting for review right now.</p>
  </div>
  ` : ''}
  <div id="memoriesList">
    ${memoriesHtml}
  </div>
</div>

<div class="toast" id="toast"></div>

<footer class="footer">
  <p>Memorial by <a href="https://gentlytold.com">GentlyTold</a> · A life, gently told.</p>
</footer>

<script>
const SLUG = '${slug}';
const TOKEN = '${token}';
const BASE = '${workerUrl}';
let remainingCount = ${count};

function updateCount(count) {
  remainingCount = count;
  const badge = document.getElementById('countBadge');
  badge.textContent = count + (count === 1 ? ' memory' : ' memories') + ' waiting for review';
  
  if (count === 0) {
    const list = document.getElementById('memoriesList');
    setTimeout(() => {
      list.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = '<div class="icon">✦</div><h2>All caught up</h2><p>No memories waiting for review right now.</p>';
      list.parentNode.insertBefore(empty, list);
    }, 500);
  }
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

async function handleAction(action, memoryId, btn) {
  const card = document.getElementById('memory-' + memoryId);
  const buttons = card.querySelectorAll('.btn');
  buttons.forEach(b => b.disabled = true);
  
  card.classList.add(action === 'approve' ? 'approved' : 'rejected');

  try {
    const res = await fetch(BASE + '/api/' + action + '/' + SLUG + '/' + memoryId + '?token=' + TOKEN, {
      method: 'POST',
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Request failed');
    }

    showToast(action === 'approve' ? '✓ Memory approved' : '✗ Memory rejected');
    
    setTimeout(() => {
      card.classList.add('removing');
      setTimeout(() => {
        card.remove();
        updateCount(data.remaining);
      }, 450);
    }, 300);

  } catch (e) {
    card.classList.remove('approved', 'rejected');
    buttons.forEach(b => b.disabled = false);
    showToast('Error: ' + e.message);
  }
}
</script>

</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
