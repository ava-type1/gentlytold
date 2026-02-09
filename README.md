# GentlyTold — Memorial Pages MVP

> *A life, gently told.*

Beautiful, permanent memorial pages for funeral homes. $50/page, funeral home charges what they want. Their branding on every page.

---

## 📁 File Structure

```
memorial-mvp/
├── README.md              ← You are here
├── template.html          ← Reusable memorial page template
├── generate.js            ← Node.js generator (no deps)
├── data/
│   └── jerry-gloria.json  ← Example data (Rhodes memorial)
├── output/                ← Generated pages go here
│   └── index.html         ← Generated output
└── site/
    ├── index.html         ← Landing page (sales page for funeral homes)
    ├── intake.html        ← Multi-step intake form
    └── contribute.html    ← Family contribution page
```

---

## 🚀 Quick Start

### Generate a memorial page

```bash
# From the memorial-mvp directory:
node generate.js data/jerry-gloria.json

# Output: output/index.html
```

### Custom output path

```bash
node generate.js data/jerry-gloria.json output/rhodes-memorial.html
```

### Custom template

```bash
node generate.js data/jerry-gloria.json output/index.html my-template.html
```

---

## 📝 Creating a New Memorial

### 1. Create a JSON data file

Copy `data/jerry-gloria.json` and modify it. All fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `isCouple` | boolean | yes | Individual or couple memorial |
| `personName1` | string | yes | Full name of first person |
| `personBorn1` | string | yes | Birth date (e.g. "March 15, 1940") |
| `personDied1` | string | yes | Date of passing |
| `personName2` | string | couples | Full name of second person |
| `personBorn2` | string | couples | Birth date of second person |
| `personDied2` | string | couples | Passing date of second person |
| `heroQuote` | string | no | Quote displayed in hero section |
| `heroPhoto` | object | no | `{src, alt}` — main photo |
| `storyTitle` | string | no | Section title (default: "Their Story") |
| `storyParagraphs` | string[] | yes | Array of story paragraphs |
| `timelineTitle` | string | no | Timeline section title |
| `timelineItems` | object[] | yes | Array of `{year, text}` |
| `newsArticles` | object[] | no | Array of `{title, source, url, description}` |
| `newsIntro` | string | no | Intro text for news section |
| `newsFootnote` | string | no | Footnote (supports HTML) |
| `businesses` | object[] | no | Array of `{name, location, description}` |
| `businessesSectionTitle` | string | no | Title for businesses section |
| `businessesIntro` | string | no | Intro paragraph |
| `photos` | object[] | yes | Array of `{src, alt}` for gallery |
| `familyMembers` | string[] | yes | Names of family members |
| `familyIntro` | string | no | Family section intro text |
| `familyNote` | string | no | Special note (e.g. "preceded in passing") |
| `closingQuote` | string | no | Closing quote |
| `formEmail` | string | yes | Email for memory submissions |
| `shareMemoryText` | string | no | Text above memory form |
| `relationshipLabel` | string | no | Label for relationship field |
| `funeralHomeName` | string | no | Funeral home name for branding |
| `funeralHomeLogo` | string | no | Path/URL to funeral home logo |
| `funeralHomePhone` | string | no | Phone number |
| `funeralHomeWebsite` | string | no | Website URL |
| `funeralHomeTagline` | string | no | Tagline |

### 2. Generate

```bash
node generate.js data/your-person.json output/their-name/index.html
```

### 3. Deploy

The output is a single HTML file with everything inline. Upload it anywhere:
- Cloudflare Pages
- Netlify
- GitHub Pages
- Any static host
- Even a simple S3 bucket

---

## 🌐 Site Pages

### Landing Page (`site/index.html`)
Sales page for funeral homes. Features:
- Hero with compelling headline
- Problem/solution comparison
- 3-step "how it works"
- Live demo link (to Rhodes memorial)
- Pricing ($50/page)
- Interactive revenue calculator
- Branding showcase
- FAQ
- CTA buttons

### Intake Form (`site/intake.html`)
4-step form for funeral homes to submit memorial info:
1. **Basic Info** — Individual/couple, names, dates, hero quote
2. **Life Story** — Story text, timeline builder, family members
3. **Photos & Branding** — Drag-and-drop photo upload, funeral home details
4. **Review & Submit** — Summary review, JSON output on submit

### Family Contribution Page (`site/contribute.html`)
Simple page for families to add memories and photos after the memorial is live:
- Name, relationship, memory text
- Photo upload with drag-and-drop
- No login required
- Submissions logged to console (backend hook ready)

---

## 🎨 Design System

Consistent across all pages:

| Element | Value |
|---------|-------|
| Background | `#0a0a0a` |
| Gold accent | `#c4a478` |
| Text primary | `#e8e0d8` |
| Text secondary | `#d4ccc4` |
| Text muted | `#a89880` |
| Heading font | Playfair Display (serif) |
| Body font | Lato (sans-serif, weight 300) |
| Cards | `rgba(196, 164, 120, 0.06)` bg, `0.15` border |

---

## 🏢 Funeral Home Branding

Every generated memorial page includes a tasteful footer:

```
Memorial lovingly prepared by
[Logo]
Funeral Home Name
(555) 123-4567 · www.funeralhome.com
"Tagline here"
```

Styled elegantly — not like an ad. Visible to every visitor, permanent.

---

## ⚡ Tech Stack

- **Zero dependencies** — no npm, no build tools, no frameworks
- **Pure Node.js** for generation (fs + path only)
- **Single HTML files** with inline CSS/JS
- **Google Fonts** (Playfair Display + Lato) via CDN
- **FormSubmit.co** for memory form submissions (free)

---

## 💰 Business Model

- We charge funeral homes **$50 per memorial page**
- They charge families **whatever they want** ($150–$300 typical)
- Their branding appears on every page permanently
- Every page share = free advertising for the funeral home
- Pages live forever at no additional hosting cost

---

## 🔮 Future Additions

- [ ] Backend API for form submissions
- [ ] Admin dashboard for funeral homes
- [ ] Automatic generation from intake form
- [ ] Custom domain support (jerry-and-gloria.gentlytold.com)
- [ ] QR code generation for funeral programs
- [ ] Video memorial support
- [ ] Guestbook with moderation
- [ ] Analytics for funeral homes (page views, shares)
