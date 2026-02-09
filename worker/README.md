# GentlyTold API — Cloudflare Worker

Memorial page generation API for [GentlyTold.com](https://gentlytold.com). Powered by Claude AI for narrative generation, Cloudflare R2 for photo storage, and a self-contained HTML template for beautiful memorial pages.

## Quick Start

```bash
# Install dependencies
npm install

# Set secrets
wrangler secret put ANTHROPIC_API_KEY   # Your Anthropic API key
wrangler secret put API_KEY             # Shared secret for X-API-Key auth

# Create R2 bucket
wrangler r2 bucket create gentlytold-photos

# Deploy
npm run deploy

# Local dev
npm run dev
```

## Environment Variables

| Variable | Type | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Secret | Anthropic API key for Claude |
| `API_KEY` | Secret | Shared API key — clients send via `X-API-Key` header |
| `MEMORIAL_PHOTOS` | R2 Binding | R2 bucket for photo storage (configured in `wrangler.toml`) |

## API Endpoints

All endpoints (except `/api/health`) require the `X-API-Key` header.

All responses include CORS headers (`Access-Control-Allow-Origin: *`).

---

### `GET /api/health`

Health check. No auth required.

**Response:**
```json
{
  "status": "ok",
  "service": "gentlytold-api",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

---

### `POST /api/generate`

Generate a polished memorial narrative from raw intake data using Claude AI.

**Headers:**
```
Content-Type: application/json
X-API-Key: your-api-key
```

**Request Body:**
```json
{
  "name": "Margaret Eleanor Thompson",
  "birthDate": "March 15, 1942",
  "deathDate": "January 8, 2025",
  "isCouple": false,
  "familyMembers": [
    { "name": "Robert Thompson", "relationship": "Husband", "note": "married 52 years" },
    { "name": "Sarah Thompson-Lee", "relationship": "Daughter" },
    { "name": "James Thompson", "relationship": "Son" }
  ],
  "obituaryText": "Margaret was born in rural Kentucky and became the first in her family to attend college. She taught English literature at Jefferson High School for 30 years, inspiring generations of students. She was known for her rose garden, her lemon pound cake, and her unwavering belief that every student had a story worth telling.",
  "timelineEvents": [
    { "year": "1942", "title": "Born in Harlan, Kentucky" },
    { "year": "1964", "title": "Graduated University of Kentucky" },
    { "year": "1965", "title": "Began teaching at Jefferson High" },
    { "year": "1970", "title": "Married Robert Thompson" },
    { "year": "1995", "title": "Retired after 30 years of teaching" }
  ],
  "quote": "A teacher affects eternity; she can never tell where her influence stops."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "storyParagraphs": [
      "Margaret Eleanor Thompson carried with her the quiet strength of the Kentucky hills where she was born...",
      "In 1964, she became the first in her family to hold a college degree...",
      "For thirty years, Room 214 at Jefferson High was her kingdom...",
      "She married Robert Thompson in the spring of 1970...",
      "Margaret's garden still blooms. Her recipes still circulate..."
    ],
    "timelineItems": [
      { "year": "1942", "title": "Born in Harlan, Kentucky", "description": "The first daughter of coal country, born to parents who dreamed she'd see wider horizons." },
      { "year": "1964", "title": "University of Kentucky Graduate", "description": "First in her family to earn a degree — in English Literature, naturally." }
    ],
    "heroQuote": "A teacher affects eternity; she can never tell where her influence stops.",
    "closingQuote": "What we have once enjoyed we can never lose. All that we love deeply becomes part of us."
  },
  "usage": { "input_tokens": 450, "output_tokens": 1200 }
}
```

---

### `POST /api/upload`

Upload photos to R2 storage.

**Headers:**
```
Content-Type: multipart/form-data
X-API-Key: your-api-key
```

**Form Fields:**
- `slug` (required) — Memorial identifier (e.g., `margaret-thompson`)
- `photo1`, `photo2`, etc. — Image files (JPEG, PNG, WebP, GIF)

**Example (curl):**
```bash
curl -X POST https://gentlytold-api.your-subdomain.workers.dev/api/upload \
  -H "X-API-Key: your-api-key" \
  -F "slug=margaret-thompson" \
  -F "photos=@family-portrait.jpg" \
  -F "photos=@garden.jpg"
```

**Response:**
```json
{
  "success": true,
  "slug": "margaret-thompson",
  "files": [
    {
      "key": "margaret-thompson/photo-1.jpg",
      "url": "/photos/margaret-thompson/photo-1.jpg",
      "originalName": "family-portrait.jpg",
      "size": 245000,
      "type": "image/jpeg"
    }
  ],
  "count": 2
}
```

---

### `POST /api/build`

Assemble a complete, self-contained HTML memorial page.

**Headers:**
```
Content-Type: application/json
X-API-Key: your-api-key
```

**Request Body:**

Pass the full memorial data — combine the output from `/api/generate` with photos, family info, and funeral home branding:

```json
{
  "name": "Margaret Eleanor Thompson",
  "birthDate": "March 15, 1942",
  "deathDate": "January 8, 2025",
  "isCouple": false,
  "portraitImage": "https://photos.gentlytold.com/margaret-thompson/portrait.jpg",
  "heroImage": "",
  "heroQuote": "A teacher affects eternity; she can never tell where her influence stops.",
  "heroQuoteAttribution": "Henry Adams",
  "storyParagraphs": ["..."],
  "timelineItems": [
    { "year": "1942", "title": "Born in Harlan, Kentucky", "description": "..." }
  ],
  "photos": [
    { "url": "https://photos.gentlytold.com/margaret-thompson/photo-1.jpg", "caption": "Family reunion, 1985" }
  ],
  "familyMembers": [
    { "name": "Robert Thompson", "relationship": "Husband" }
  ],
  "closingQuote": "What we have once enjoyed we can never lose.",
  "closingQuoteAttribution": "Helen Keller",
  "funeralHomeName": "Greenwood Memorial",
  "funeralHomeUrl": "https://greenwoodmemorial.com",
  "memoryFormEnabled": true
}
```

**Response:** Complete HTML page (`Content-Type: text/html`).

---

## Design Spec

The generated memorial pages feature:

- **Dark, elegant palette**: Background `#0a0a0a`, gold accents `#c4a478`, cream text `#e8e0d8`
- **Typography**: Playfair Display (headings), Lato (body)
- **Sections**: Hero (with portrait + quote), Story, Timeline, Photo Gallery (with lightbox), Share a Memory form, Family, Footer
- **Responsive**: Graceful mobile layout
- **Self-contained**: Single HTML file, no external dependencies except Google Fonts
- **Couples support**: Dual portraits, shared timeline, "Their Story" framing

## Architecture

```
Client (intake form)
  → POST /api/generate  →  Claude AI  →  Structured narrative JSON
  → POST /api/upload    →  R2 bucket  →  Photo URLs
  → POST /api/build     →  HTML template engine  →  Complete memorial page
```

## Cost Estimates

| Component | Cost |
|---|---|
| Cloudflare Worker | Free tier: 100K requests/day |
| R2 Storage | $0.015/GB/month, free egress |
| Claude API (sonnet) | ~$0.01–0.03 per memorial generation |

## License

Proprietary — GentlyTold.com
