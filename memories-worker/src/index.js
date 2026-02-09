/**
 * GentlyTold — Memories API Worker
 * Stores and serves shared memories (with optional photos) for memorial pages
 * Uses Cloudflare KV for storage
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // GET /api/photo/:key — Serve a stored photo
    if (request.method === 'GET' && url.pathname.startsWith('/api/photo/')) {
      const key = url.pathname.replace('/api/photo/', '');
      if (!key) return new Response('Missing key', { status: 400, headers: corsHeaders });

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

    // POST /api/memories/:slug — Add a memory (with optional photo)
    if (request.method === 'POST' && url.pathname.startsWith('/api/memories/')) {
      const slug = url.pathname.split('/')[3];
      if (!slug) return new Response('Missing memorial slug', { status: 400, headers: corsHeaders });

      try {
        const formData = await request.formData();
        const id = crypto.randomUUID();
        
        const memory = {
          id,
          name: formData.get('name') || 'Anonymous',
          relationship: formData.get('relationship') || '',
          memory: formData.get('memory') || '',
          date: new Date().toISOString(),
        };

        // Handle photo upload
        const photo = formData.get('photo');
        if (photo && photo.size > 0) {
          // Limit to 5MB
          if (photo.size > 5 * 1024 * 1024) {
            return new Response(JSON.stringify({ error: 'Photo must be under 5MB' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
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

        // Get existing memories and add new one
        const existing = await env.MEMORIES.get(`memories:${slug}`, 'json') || [];
        existing.push(memory);
        await env.MEMORIES.put(`memories:${slug}`, JSON.stringify(existing));

        return new Response(JSON.stringify({ success: true, memory }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // GET /api/memories/:slug — Get all memories for a memorial
    if (request.method === 'GET' && url.pathname.startsWith('/api/memories/')) {
      const slug = url.pathname.split('/')[3];
      if (!slug) return new Response('Missing memorial slug', { status: 400, headers: corsHeaders });

      const memories = await env.MEMORIES.get(`memories:${slug}`, 'json') || [];
      return new Response(JSON.stringify(memories), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });
  },
};
