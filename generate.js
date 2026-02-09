#!/usr/bin/env node

/**
 * GentlyTold Memorial Page Generator
 * 
 * Usage: node generate.js <data.json> [output.html] [template.html]
 * 
 * Reads a JSON data file and template, outputs a complete memorial page.
 * No npm dependencies required.
 */

const fs = require('fs');
const path = require('path');

// --- Args ---
const args = process.argv.slice(2);
if (args.length < 1) {
    console.error('Usage: node generate.js <data.json> [output.html] [template.html]');
    console.error('');
    console.error('Examples:');
    console.error('  node generate.js data/jerry-gloria.json');
    console.error('  node generate.js data/jerry-gloria.json output/rhodes.html');
    console.error('  node generate.js data/jerry-gloria.json output/rhodes.html template.html');
    process.exit(1);
}

const dataFile = args[0];
const outputFile = args[1] || 'output/index.html';
const templateFile = args[2] || path.join(__dirname, 'template.html');

// --- Load files ---
let data, template;

try {
    data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
} catch (e) {
    console.error(`Error reading data file: ${e.message}`);
    process.exit(1);
}

try {
    template = fs.readFileSync(templateFile, 'utf8');
} catch (e) {
    console.error(`Error reading template: ${e.message}`);
    process.exit(1);
}

// --- Helper: Escape HTML ---
function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// --- Build page title ---
function buildPageTitle() {
    const first = data.personName1.split(' ');
    const firstName1 = first[0];
    if (data.isCouple && data.personName2) {
        const second = data.personName2.split(' ');
        const firstName2 = second[0];
        // Use last name from person 1
        const lastName = first[first.length - 1];
        return `${data.personName1} & ${data.personName2}`;
    }
    return data.personName1;
}

const pageTitle = buildPageTitle();

// --- Build hero content ---
function buildHeroContent() {
    let html = '';
    
    if (data.isCouple && data.personName2) {
        // Extract first names for display
        const name1Parts = data.personName1.split(' ');
        const name2Parts = data.personName2.split(' ');
        // Remove last name from person2 if same as person1
        const lastName1 = name1Parts[name1Parts.length - 1];
        const lastName2 = name2Parts[name2Parts.length - 1];
        
        let displayName1 = data.personName1;
        let displayName2 = data.personName2;
        
        // If couple shares last name, show "First Middle <amp> First Middle LastName"
        if (lastName1 === lastName2) {
            const withoutLast1 = name1Parts.slice(0, -1).join(' ');
            html += `<h1>${esc(withoutLast1)} <span class="ampersand">&amp;</span> ${esc(displayName2)}</h1>\n`;
        } else {
            html += `<h1>${esc(displayName1)} <span class="ampersand">&amp;</span> ${esc(displayName2)}</h1>\n`;
        }
        
        html += `        <div class="dates">\n`;
        html += `            ${esc(data.personBorn1)} — ${esc(data.personDied1)} &nbsp;&nbsp;·&nbsp;&nbsp; ${esc(data.personBorn2)} — ${esc(data.personDied2)}\n`;
        html += `        </div>\n`;
    } else {
        html += `<h1>${esc(data.personName1)}</h1>\n`;
        html += `        <div class="dates">\n`;
        html += `            ${esc(data.personBorn1)} — ${esc(data.personDied1)}\n`;
        html += `        </div>\n`;
    }
    
    if (data.heroQuote) {
        html += `        <p class="in-memoriam">"${esc(data.heroQuote)}"</p>\n`;
    }
    
    if (data.heroPhoto && data.heroPhoto.src) {
        html += `        <div class="photo-frame">\n`;
        html += `            <img src="${esc(data.heroPhoto.src)}" alt="${esc(data.heroPhoto.alt || '')}">\n`;
        html += `        </div>\n`;
    } else {
        html += `        <div class="photo-frame">\n`;
        html += `            <span class="photo-placeholder">Photo</span>\n`;
        html += `        </div>\n`;
    }
    
    return html;
}

// --- Build story paragraphs ---
function buildStoryParagraphs() {
    if (!data.storyParagraphs || data.storyParagraphs.length === 0) return '';
    return data.storyParagraphs.map(p => `        <p>\n            ${p}\n        </p>`).join('\n');
}

// --- Build timeline ---
function buildTimeline() {
    if (!data.timelineItems || data.timelineItems.length === 0) return '';
    return data.timelineItems.map(item => {
        return `            <div class="timeline-item">
                <div class="timeline-year">${esc(item.year)}</div>
                <div class="timeline-text">${item.text}</div>
            </div>`;
    }).join('\n');
}

// --- Build news section ---
function buildNewsSection() {
    if (!data.newsArticles || data.newsArticles.length === 0) return '';
    
    let html = `    <!-- In the News -->\n    <section class="section">\n        <h2>In the News</h2>\n        <div class="section-divider"></div>\n`;
    
    if (data.newsIntro) {
        html += `        <p>${data.newsIntro}</p>\n\n`;
    }
    
    data.newsArticles.forEach(article => {
        html += `        <div class="card">\n`;
        html += `            <h3>${article.title}</h3>\n`;
        if (article.url) {
            html += `            <div class="location"><a href="${esc(article.url)}" target="_blank" style="color: #c4a478;">${esc(article.source)} ↗</a></div>\n`;
        } else {
            html += `            <div class="location">${esc(article.source)}</div>\n`;
        }
        html += `            <p>${article.description}</p>\n`;
        html += `        </div>\n\n`;
    });
    
    if (data.newsFootnote) {
        html += `        <p style="text-align: center; font-style: italic; color: #a89880; margin-top: 2rem;">\n            ${data.newsFootnote}\n        </p>\n`;
    }
    
    html += `    </section>`;
    return html;
}

// --- Build businesses section ---
function buildBusinessesSection() {
    if (!data.businesses || data.businesses.length === 0) return '';
    
    let html = `    <!-- Businesses -->\n    <section class="section">\n        <h2>${esc(data.businessesSectionTitle || 'Business')}</h2>\n        <div class="section-divider"></div>\n`;
    
    if (data.businessesIntro) {
        html += `        <p>${data.businessesIntro}</p>\n\n`;
    }
    
    data.businesses.forEach(biz => {
        html += `        <div class="card">\n`;
        html += `            <h3>${esc(biz.name)}</h3>\n`;
        html += `            <div class="location">${biz.location}</div>\n`;
        html += `            <p>${biz.description}</p>\n`;
        html += `        </div>\n\n`;
    });
    
    html += `    </section>`;
    return html;
}

// --- Build videos section ---
function buildVideosSection() {
    if (!data.videos || data.videos.length === 0) return '';

    let html = `    <!-- Cherished Moments -->\n    <section class="section">\n        <h2>Cherished Moments</h2>\n        <div class="section-divider"></div>\n        <div class="videos-grid">\n`;

    data.videos.forEach(video => {
        html += `            <div class="video-card">\n`;
        html += `                <div class="video-wrapper">\n`;

        if (video.type === 'youtube') {
            const videoId = extractYouTubeId(video.url);
            if (videoId) {
                html += `                    <iframe src="https://www.youtube-nocookie.com/embed/${esc(videoId)}" title="${esc(video.caption || '')}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>\n`;
            }
        } else if (video.type === 'vimeo') {
            const videoId = extractVimeoId(video.url);
            if (videoId) {
                html += `                    <iframe src="https://player.vimeo.com/video/${esc(videoId)}?dnt=1" title="${esc(video.caption || '')}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>\n`;
            }
        } else if (video.type === 'direct') {
            html += `                    <video controls preload="metadata"`;
            if (video.thumbnail) {
                html += ` poster="${esc(video.thumbnail)}"`;
            }
            html += `>\n`;
            html += `                        <source src="${esc(video.url)}" type="video/mp4">\n`;
            html += `                        Your browser does not support the video tag.\n`;
            html += `                    </video>\n`;
        }

        html += `                </div>\n`;

        if (video.caption) {
            html += `                <div class="video-caption">${esc(video.caption)}</div>\n`;
        }

        html += `            </div>\n`;
    });

    html += `        </div>\n    </section>`;
    return html;
}

function extractYouTubeId(url) {
    if (!url) return null;
    // Handle youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID, youtube.com/shorts/ID
    const patterns = [
        /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

function extractVimeoId(url) {
    if (!url) return null;
    const match = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    return match ? match[1] : null;
}

// --- Build gallery ---
function buildGallery() {
    if (!data.photos || data.photos.length === 0) {
        return `            <div class="gallery-item">\n                <span class="photo-placeholder">Photos coming soon</span>\n            </div>`;
    }
    return data.photos.map(photo => {
        return `            <div class="gallery-item">
                <img src="${esc(photo.src)}" alt="${esc(photo.alt || '')}">
            </div>`;
    }).join('\n');
}

// --- Build family names ---
function buildFamilyNames() {
    if (!data.familyMembers || data.familyMembers.length === 0) return '';
    return data.familyMembers.join(' &nbsp;·&nbsp; ');
}

// --- Build family note ---
function buildFamilyNote() {
    if (!data.familyNote) return '';
    return `            <p class="note">${esc(data.familyNote)}</p>`;
}

// --- Build funeral home branding ---
function buildFuneralHomeBranding() {
    if (!data.funeralHomeName) return '';
    
    let html = `    <!-- Funeral Home Branding -->\n    <div class="funeral-home-branding">\n`;
    html += `        <div class="prepared-by">Memorial lovingly prepared by</div>\n`;
    
    if (data.funeralHomeLogo) {
        html += `        <img src="${esc(data.funeralHomeLogo)}" alt="${esc(data.funeralHomeName)}" class="fh-logo"><br>\n`;
    }
    
    html += `        <div class="fh-name">${esc(data.funeralHomeName)}</div>\n`;
    html += `        <div class="fh-details">\n`;
    
    const details = [];
    if (data.funeralHomePhone) {
        details.push(esc(data.funeralHomePhone));
    }
    if (data.funeralHomeWebsite) {
        details.push(`<a href="${esc(data.funeralHomeWebsite)}" target="_blank">${esc(data.funeralHomeWebsite.replace(/^https?:\/\//, ''))}</a>`);
    }
    
    if (details.length > 0) {
        html += `            ${details.join(' &nbsp;·&nbsp; ')}\n`;
    }
    
    html += `        </div>\n`;
    
    if (data.funeralHomeTagline) {
        html += `        <div class="fh-tagline">${esc(data.funeralHomeTagline)}</div>\n`;
    }
    
    html += `    </div>`;
    return html;
}

// --- Perform replacements ---
let output = template;

const replacements = {
    '{{pageTitle}}': pageTitle,
    '{{heroContent}}': buildHeroContent(),
    '{{storyTitle}}': esc(data.storyTitle || (data.isCouple ? 'Their Story' : 'Their Story')),
    '{{storyParagraphsHTML}}': buildStoryParagraphs(),
    '{{timelineTitle}}': esc(data.timelineTitle || (data.isCouple ? 'A Life Together' : 'A Life Remembered')),
    '{{timelineHTML}}': buildTimeline(),
    '{{newsSection}}': buildNewsSection(),
    '{{businessesSection}}': buildBusinessesSection(),
    '{{videosSection}}': buildVideosSection(),
    '{{galleryHTML}}': buildGallery(),
    '{{shareMemoryText}}': data.shareMemoryText || `If they touched your life, we'd love to hear from you. Share a story, a memory, or a photo.`,
    '{{relationshipLabel}}': esc(data.relationshipLabel || 'How did you know them?'),
    '{{formEmail}}': esc(data.formEmail || ''),
    '{{closingQuote}}': esc(data.closingQuote || ''),
    '{{familyIntro}}': data.familyIntro || '',
    '{{familyNamesHTML}}': buildFamilyNames(),
    '{{familyNoteHTML}}': buildFamilyNote(),
    '{{funeralHomeBrandingHTML}}': buildFuneralHomeBranding(),
    '{{heroQuote}}': esc(data.heroQuote || '')
};

for (const [key, value] of Object.entries(replacements)) {
    // Replace all occurrences
    while (output.includes(key)) {
        output = output.replace(key, value);
    }
}

// --- Write output ---
const outputDir = path.dirname(outputFile);
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(outputFile, output, 'utf8');
console.log(`✓ Memorial page generated: ${outputFile}`);
console.log(`  Title: ${pageTitle}`);
console.log(`  Sections: story, timeline${data.newsArticles ? ', news' : ''}${data.businesses ? ', businesses' : ''}${data.videos && data.videos.length ? ', videos' : ''}, gallery, memories, family`);
console.log(`  Funeral home: ${data.funeralHomeName || 'none'}`);
