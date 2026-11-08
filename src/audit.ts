import { chromium, type Browser, type Page } from 'playwright-chromium';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeUrl, prioritize, score, type Category, type Finding, type PageResult, type Report, type Severity } from './model.js';
import { assessSchemas, citability } from './aeo.js';

export interface Options { pages: number; mobile: boolean; screenshot: boolean; timeout: number; output: string; progress?: (message: string) => void }
const agent = 'web-audit-skill';
const robotsParser = createRequire(import.meta.url)('robots-parser') as (url: string, text: string) => { isAllowed(url: string, userAgent: string): boolean | undefined };
const sleepTimeout = (ms: number) => AbortSignal.timeout(Math.max(1, ms));
function finding(url: string, category: Category, severity: Severity, id: string, title: string, detail: string, recommendation: string): Finding {
  const effort: Finding['estimated_effort'] = ['thin-content', 'structure', 'contrast', 'blocking', 'images', 'lcp', 'cls'].includes(id) ? 'high' : ['labels', 'heading-order', 'provenance-author', 'provenance-date', 'sources', 'schema-quality'].some(x => id.startsWith(x)) ? 'medium' : 'low';
  return { url, category, severity, priority: severity === 'info' ? 'low' : severity, estimated_effort: effort, suggested_fix: recommendation, id, title, detail, recommendation };
}
function sameOrigin(url: string, origin: string): boolean { try { return new URL(url).origin === origin; } catch { return false; } }

export async function audit(input: string, options: Options): Promise<Report> {
  const start = Date.now(); const requestedUrl = normalizeUrl(input); const origin = new URL(requestedUrl).origin;
  const warnings: string[] = []; const results: PageResult[] = []; const queue = [{ url: requestedUrl, depth: 0 }]; const seen = new Set<string>();
  const robotsUrl = new URL('/robots.txt', origin).href;
  let robotsText = ''; let robotsAvailable = true;
  try {
    const response = await fetch(robotsUrl, { redirect: 'manual', signal: sleepTimeout(options.timeout * 1000), headers: { 'user-agent': agent } });
    if (response.ok) robotsText = await response.text();
    else if (response.status !== 404 && response.status !== 410) { robotsAvailable = false; warnings.push(`robots.txt returned HTTP ${response.status}; crawl stopped because permission could not be determined.`); }
  } catch (e) { robotsAvailable = false; warnings.push(`Could not retrieve robots.txt; crawl stopped: ${String(e)}`); }
  const robots = robotsParser(robotsUrl, robotsText);
  const allowed = (u: string) => robotsAvailable && sameOrigin(u, origin) && robots.isAllowed(u, agent) !== false;
  if (robotsAvailable && !allowed(requestedUrl)) warnings.push('The requested URL is disallowed by robots.txt.');
  let sitemapPresent = /^\s*sitemap\s*:/im.test(robotsText);
  if (robotsAvailable && !sitemapPresent && allowed(new URL('/sitemap.xml', origin).href)) {
    try { const s = await fetch(new URL('/sitemap.xml', origin), { method: 'HEAD', redirect: 'manual', signal: sleepTimeout(Math.min(options.timeout * 1000, 5000)), headers: { 'user-agent': agent } }); sitemapPresent = s.ok; } catch { warnings.push('Could not verify /sitemap.xml.'); }
  }
  let browser: Browser | undefined;
  if (allowed(requestedUrl)) {
    browser = await chromium.launch({ headless: true, ...(process.env.WEB_AUDIT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WEB_AUDIT_CHROMIUM_EXECUTABLE } : {}) });
    try {
      while (queue.length && results.length < options.pages) {
        const item = queue.shift()!; if (seen.has(item.url) || !allowed(item.url)) continue; seen.add(item.url);
        options.progress?.(`Auditing ${item.url}`);
        try {
          const result = await inspect(browser, item.url, options, allowed, sitemapPresent, warnings);
          results.push(result.page);
          if (item.depth < 2) for (const link of result.links) {
            try { const u = normalizeUrl(link); if (allowed(u) && !seen.has(u) && !queue.some(q => q.url === u)) queue.push({ url: u, depth: item.depth + 1 }); } catch { /* Ignore non-HTTP links. */ }
          }
        } catch (e) { warnings.push(`Could not audit ${item.url}: ${String(e)}`); }
      }
    } finally { await browser.close(); }
  }
  if (!results.length) warnings.push('No pages were audited; scores are unavailable.');
  warnings.push('Performance observations cover only a short desktop visit; INP and field Core Web Vitals are not measured. Contrast and link checks are samples, not comprehensive tests.');
  if (!options.mobile) warnings.push('Mobile viewport rendering was not requested; the mobile score is unavailable. Viewport metadata was still checked.');
  else if (results.some(p => !p.metrics.mobile)) warnings.push('At least one mobile viewport check failed; the mobile score is unavailable.');
  const findings = results.flatMap(p => p.findings);
  const scores = score(findings, results.length, options.mobile && results.every(p => !!p.metrics.mobile));
  const citabilityScores = results.map(p => (p.metrics.ai_citability as { score: number }).score);
  scores.ai_citability = citabilityScores.length ? Math.round(citabilityScores.reduce((a, b) => a + b, 0) / citabilityScores.length) : null;
  const prioritizedFixes = prioritize(findings);
  const executive_summary = results.length ? [
    `Audited ${results.length} page(s); overall score ${scores.overall}/100 and AI citability ${scores.ai_citability}/100.`,
    `${findings.length} finding(s), including ${findings.filter(f => f.priority === 'high').length} high-priority issue(s).`,
    ...(prioritizedFixes.length ? [`First priority: ${prioritizedFixes[0].title} (${prioritizedFixes[0].url}).`] : ['No issues detected by the checks that ran.']),
    'Scores are heuristics; review page context and coverage warnings before acting.'
  ] : ['No pages audited; scores are unavailable.', 'Review coverage warnings before retrying.'];
  return { executive_summary, schemaVersion: '1.1', requestedUrl, generatedAt: new Date().toISOString(), durationMs: Date.now() - start, scores, pages: results, prioritizedFixes, warnings };
}

async function inspect(browser: Browser, url: string, options: Options, allowed: (u: string) => boolean, sitemapPresent: boolean, warnings: string[]): Promise<{page: PageResult; links: string[]}> {
  const context = await browser.newContext({ viewport: { width: 1365, height: 768 }, userAgent: `web-audit-skill/1.0 (+https://github.com/)` });
  try {
    await context.route('**/*', async route => {
      const req = route.request();
      if (req.isNavigationRequest() && req.frame() === req.frame().page().mainFrame() && !allowed(req.url())) await route.abort();
      else await route.continue();
    });
    await context.addInitScript(() => {
      const metrics = { lcp: null as number | null, cls: 0 };
      (window as unknown as { __auditVitals: typeof metrics }).__auditVitals = metrics;
      try { new PerformanceObserver(list => { for (const entry of list.getEntries()) metrics.lcp = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch { /* unsupported */ }
      try { new PerformanceObserver(list => { for (const entry of list.getEntries()) { const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number }; if (!shift.hadRecentInput) metrics.cls += shift.value; } }).observe({ type: 'layout-shift', buffered: true }); } catch { /* unsupported */ }
    });
    const page = await context.newPage(); page.setDefaultTimeout(options.timeout * 1000);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeout * 1000 });
    if (!response) throw new Error('Navigation returned no HTTP response');
    await page.waitForTimeout(500);
    const current = page.url(); const data = await collect(page); const findings: Finding[] = [];
    const schemas = assessSchemas(data.structuredData);
    const ai_citability = citability({ words: data.words, sentences: data.sentences, headings: data.headings, skippedHeadings: data.skippedHeadings, h1: data.h1, paragraphs: data.paragraphs, namedEntities: data.namedEntities, author: data.author, published: data.published, updated: data.updated, externalLinks: data.externalLinks });
    const add = (cat: Category, sev: Severity, id: string, title: string, detail: string, fix: string) => findings.push(finding(current, cat, sev, id, title, detail, fix));
    if (response.status() >= 400) add('seo','high','http-error','Page returned an error', `HTTP ${response.status()}`, 'Fix the server response or remove the link.');
    if (!data.title) add('seo','high','title','Missing title','No nonempty title element.', 'Add a unique descriptive title.');
    else if (data.title.length < 20 || data.title.length > 65) add('seo','low','title-length','Title may be too short or long',`${data.title.length} characters.`, 'Use a concise, descriptive title.');
    if (!data.description) add('seo','medium','description','Missing meta description','No nonempty meta description.', 'Write a unique summary for this page.');
    if (data.h1 !== 1) add('seo','medium','h1','Unexpected H1 count',`${data.h1} H1 elements.`, 'Use one descriptive H1 for the main topic.');
    if (!data.canonical) add('seo','medium','canonical','Missing canonical URL','No canonical link found.', 'Add a canonical URL for the preferred version.');
    if (!data.lang) add('seo','medium','lang','Missing document language','The html element has no lang attribute.', 'Set a valid language on the html element.');
    if (!data.jsonLd) add('seo','low','jsonld','No JSON-LD found','No JSON-LD script detected.', 'Add relevant, accurate structured data where appropriate.');
    if (data.invalidJsonLd) add('seo','medium','jsonld-invalid','Invalid JSON-LD',`${data.invalidJsonLd} JSON-LD block(s) could not be parsed.`, 'Correct JSON syntax and validate the structured data.');
    if (!data.og || !data.twitter) add('seo','low','social','Incomplete social metadata',`Open Graph title: ${data.og}; Twitter card: ${data.twitter}.`, 'Add appropriate Open Graph and Twitter card metadata.');
    if (!sitemapPresent) add('seo','low','sitemap','Sitemap not detected','No Sitemap directive or successful /sitemap.xml HEAD response.', 'Publish a sitemap and reference it from robots.txt.');
    if (data.noindex) add('seo','medium','noindex','Page may be excluded from search','A robots meta tag or HTTP header contains noindex.', 'Remove noindex if this page should be indexed.');
    if (data.words < 200) add('aeo','high','thin-content','Limited readable text',`${data.words} visible words in the main content sample.`, 'Add useful, specific content answering the page’s primary question.');
    if (data.headings < 2) add('aeo','medium','structure','Few content sections',`${data.headings} headings found.`, 'Organize useful answers under descriptive headings.');
    if (!data.author) add('aeo','medium','provenance-author','No author signal','No author metadata, author relation, or named Article author detected.', 'Add a visible byline and matching author metadata where relevant.');
    if (!data.published && !data.updated) add('aeo','medium','provenance-date','No publication or update date','No publication or update metadata or dated time element detected.', 'Add an accurate visible publication or update date and a time element with a datetime attribute.');
    if (data.skippedHeadings) add('aeo','medium','aeo-heading-order','Disordered content hierarchy',`${data.skippedHeadings} heading level jump(s) make the structure harder to follow.`, 'Use one H1 for the topic, H2s for sections, and H3s for subsections without skipping levels.');
    if (ai_citability.score < 50) add('aeo','medium','citability','Low AI citability signals',`Heuristic score ${ai_citability.score}/100; component scores: ${JSON.stringify(ai_citability.components)}.`, 'Clarify the answer, identify the subject and author, add relevant context and organize it under descriptive headings.');
    for (const [kind, assessment] of Object.entries(schemas)) if (assessment.score !== null && assessment.score < 100) add('aeo','medium',`schema-quality-${kind.toLowerCase()}`,`Incomplete ${kind} structured data`,`${assessment.count} item(s); heuristic completeness ${assessment.score}/100; missing: ${assessment.missing.join(', ')}.`, `Add the missing ${assessment.missing.join(', ')} properties to accurate ${kind} JSON-LD that matches visible content.`);
    if (!data.faqHowto) add('aeo','low','faq-howto','No FAQ or HowTo signal','No FAQ/HowTo heading or structured-data type found.', 'Consider direct question-and-answer sections when useful to readers.');
    if (!data.entitySignals) add('aeo','low','entity-context','Limited machine-readable entity context','No Organization, Person, Product, or Article JSON-LD type detected.', 'Where applicable, identify the subject and publisher clearly and add relevant structured data.');
    if (data.words >= 200 && data.externalLinks === 0) add('aeo','low','sources','No external source links detected','No external links detected in main content.', 'Cite primary sources for claims where appropriate.');
    if (data.skippedHeadings) add('accessibility','medium','heading-order','Heading levels skipped',`${data.skippedHeadings} upward level jumps detected.`, 'Use a logical heading hierarchy.');
    if (data.imagesWithoutAlt) add('accessibility','medium','alt','Images missing alt attributes',`${data.imagesWithoutAlt} images lack an alt attribute.`, 'Add descriptive alt text, or alt="" for decorative images.');
    if (data.unlabelled) add('accessibility','high','labels','Form fields without accessible label signals',`${data.unlabelled} fields lack a label, aria-label, or aria-labelledby.`, 'Provide a programmatic label for every form field.');
    if (!data.main) add('accessibility','medium','main','Main landmark missing','No main element or role=main found.', 'Mark the primary content with a main landmark.');
    if (data.lowContrast) add('accessibility','medium','contrast','Potential low contrast',`${data.lowContrast} of ${data.contrastSamples} sampled text elements appear below 4.5:1.`, 'Check contrast manually, including large text and backgrounds.');
    if (data.unoptimizedImages) add('performance','medium','images','Potentially unoptimized images',`${data.unoptimizedImages} images have neither lazy loading nor explicit dimensions.`, 'Use responsive image sizes, modern formats, and appropriate lazy loading.');
    if (data.blockingScripts) add('performance','medium','blocking','Potential render-blocking resources',`${data.blockingScripts} synchronous head scripts or stylesheets.`, 'Reduce critical CSS and defer nonessential scripts.');
    if (data.fonts) add('performance','low','fonts','Web fonts detected',`${data.fonts} font resource(s) observed.`, 'Use font-display and minimize font files; verify actual loading behavior.');
    if (data.lcp !== null && data.lcp > 2500) add('performance','medium','lcp','Slow observed LCP candidate',`${Math.round(data.lcp)} ms in this synthetic visit.`, 'Optimize the largest content element and its delivery; verify with field data.');
    if (data.cls > 0.1) add('performance','medium','cls','Layout shifts observed',`CLS ${data.cls.toFixed(3)} during the short observation.`, 'Reserve space for dynamic content and media.');
    if (!data.viewport) add('mobile','high','viewport','Viewport meta tag missing','No viewport meta tag found.', 'Add a responsive viewport meta tag.');
    const headers = response.headers();
    for (const [name, severity, recommendation] of [['content-security-policy','medium','Define a suitable Content-Security-Policy.'],['x-content-type-options','medium','Set X-Content-Type-Options: nosniff.'],['x-frame-options','low','Set frame-ancestors in CSP or X-Frame-Options.'],['referrer-policy','low','Set a suitable Referrer-Policy.']] as const) {
      if (!headers[name] && !(name === 'x-frame-options' && /frame-ancestors/i.test(headers['content-security-policy'] || ''))) add('security',severity,`header-${name}`,`Missing ${name} header`,'Header was not present on the document response.',recommendation);
    }
    if (current.startsWith('https:') && !headers['strict-transport-security']) add('security','medium','hsts','Missing HSTS header','Strict-Transport-Security was not present.', 'Configure HSTS after verifying HTTPS readiness.');
    if (/noindex/i.test(headers['x-robots-tag'] || '') && !data.noindex) add('seo','medium','noindex-header','HTTP noindex directive','X-Robots-Tag includes noindex.', 'Remove the directive if the page should be indexed.');
    const redirects: string[] = []; let req = response.request().redirectedFrom(); while (req) { redirects.unshift(req.url()); req = req.redirectedFrom(); }
    if (redirects.length > 1) add('seo','medium','redirect-chain','Redirect chain',`${redirects.length} redirects before the final page.`, 'Link directly to the final canonical URL.');
    let screenshot: string | undefined;
    if (options.screenshot) { await mkdir(options.output, { recursive: true }); screenshot = `page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`; await page.screenshot({ path: join(options.output, screenshot), fullPage: true, timeout: options.timeout * 1000 }); }
    if (options.mobile) {
      const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'web-audit-skill/1.0' });
      try {
        await mobile.route('**/*', async route => { const req = route.request(); if (req.isNavigationRequest() && req.frame() === req.frame().page().mainFrame() && !allowed(req.url())) await route.abort(); else await route.continue(); });
        const mp = await mobile.newPage(); await mp.goto(current, { waitUntil: 'domcontentloaded', timeout: options.timeout * 1000 });
        const mobileData = await mp.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, title: document.title }));
        Object.assign(data, { mobile: mobileData });
        if (mobileData.width > mobileData.viewport + 1) add('mobile','medium','overflow','Horizontal mobile overflow',`Document width ${mobileData.width}px exceeds viewport ${mobileData.viewport}px.`, 'Fix elements wider than the mobile viewport.');
        if (options.screenshot) await mp.screenshot({ path: join(options.output, screenshot!.replace('.png', '-mobile.png')), fullPage: true, timeout: options.timeout * 1000 });
      } catch (e) { warnings.push(`Mobile check failed for ${current}: ${String(e)}`); } finally { await mobile.close(); }
    }
    // Sample links conservatively; HEAD failures are reported as inconclusive, not broken.
    const links = [...new Set(data.links.filter(u => allowed(u)))].slice(0, 5);
    for (const link of links) {
      try { const r = await fetch(link, { method: 'HEAD', redirect: 'manual', signal: sleepTimeout(Math.min(3000, options.timeout * 1000)), headers: { 'user-agent': agent } }); if (r.status >= 400 && r.status !== 405 && r.status !== 403 && r.status !== 429) add('seo','medium','broken-link','Potential broken internal link',`${link} returned HTTP ${r.status} to HEAD.`, 'Check the destination and repair or remove the link.'); }
      catch { warnings.push(`Could not check sampled link ${link}.`); }
    }
    const { links: allLinks, structuredData: _structuredData, ...metrics } = data;
    return { page: { url: current, status: response.status(), title: data.title, metrics: { ...metrics, schema_quality: schemas, ai_citability }, findings, redirects, ...(screenshot ? { screenshot } : {}) }, links: allLinks };
  } finally { await context.close(); }
}

async function collect(page: Page) {
  return page.evaluate(() => {
    const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"],meta[property="${name}"]`)?.content.trim() || '';
    const main = document.querySelector<HTMLElement>('main,[role="main"],article') || document.body;
    const text = (main?.innerText || '').trim();
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    let skippedHeadings = 0; for (let i = 1; i < headings.length; i++) if (Number(headings[i].tagName[1]) > Number(headings[i - 1].tagName[1]) + 1) skippedHeadings++;
    const blocks = [...document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')]; let invalidJsonLd = 0; const structuredData: unknown[] = [];
    for (const b of blocks) try { structuredData.push(JSON.parse(b.textContent || '')); } catch { invalidJsonLd++; }
    const entityNames = new Set<string>(); let schemaAuthor = false, schemaPublished = false, schemaUpdated = false;
    const visit = (x: unknown): void => {
      if (Array.isArray(x)) { x.forEach(visit); return; } if (!x || typeof x !== 'object') return;
      const n = x as Record<string, unknown>; const types = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
      if (types.some(t => typeof t === 'string' && /(?:^|\/)(Organization|Person|Product|Place|Article|NewsArticle|BlogPosting)$/.test(t)) && typeof n.name === 'string' && n.name.trim()) entityNames.add(n.name.trim().toLowerCase());
      if (types.some(t => typeof t === 'string' && /(?:^|\/)(Article|NewsArticle|BlogPosting)$/.test(t))) {
        const authors = Array.isArray(n.author) ? n.author : [n.author];
        schemaAuthor ||= authors.some(a => typeof a === 'string' ? !!a.trim() : !!a && typeof a === 'object' && typeof (a as Record<string, unknown>).name === 'string' && !!((a as Record<string, unknown>).name as string).trim());
        schemaPublished ||= typeof n.datePublished === 'string' && !!n.datePublished.trim(); schemaUpdated ||= typeof n.dateModified === 'string' && !!n.dateModified.trim();
      }
      Object.values(n).forEach(visit);
    };
    structuredData.forEach(visit);
    const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].map(a => a.href).filter(Boolean);
    const unlabelled = [...document.querySelectorAll<HTMLInputElement>('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea')].filter(el => !(el.labels?.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title'))).length;
    let lowContrast = 0, contrastSamples = 0;
    const parse = (s: string) => { const m = s.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/); return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] : null; };
    const luminance = (c: number[]) => c.slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
    for (const el of [...document.querySelectorAll('p,li,h1,h2,h3,button,a')].slice(0, 40)) {
      const style = getComputedStyle(el); if (!el.textContent?.trim() || style.display === 'none' || style.visibility === 'hidden') continue;
      const fg = parse(style.color); let parent: Element | null = el; let bg: number[] | null = null;
      while (parent && !bg) { const st = getComputedStyle(parent); if (st.backgroundImage !== 'none') break; const candidate = parse(st.backgroundColor); if (candidate && candidate[3] === 1) bg = candidate; parent = parent.parentElement; }
      if (!fg || fg[3] !== 1 || !bg) continue;
      const a = luminance(fg), b = luminance(bg); const ratio = (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
      contrastSamples++; if (ratio < 4.5) lowContrast++;
    }
    const vital = (window as unknown as { __auditVitals?: { lcp: number | null; cls: number } }).__auditVitals;
    return {
      title: document.title.trim(), description: meta('description'), h1: document.querySelectorAll('h1').length,
      canonical: document.querySelector<HTMLLinkElement>('link[rel~="canonical"]')?.href || '', lang: document.documentElement.lang,
      jsonLd: blocks.length, invalidJsonLd, og: !!meta('og:title'), twitter: !!meta('twitter:card'),
      hreflang: [...document.querySelectorAll<HTMLLinkElement>('link[rel="alternate"][hreflang]')].map(x => ({ lang: x.hreflang, href: x.href })),
      noindex: /noindex/i.test(meta('robots') + ' ' + meta('googlebot')), words: text ? text.split(/\s+/).length : 0,
      headings: headings.length, skippedHeadings, author: !!(meta('author') || document.querySelector('[rel="author"], [itemprop="author"]') || schemaAuthor),
      published: !!(document.querySelector('time[datetime], [itemprop="datePublished"]') || meta('article:published_time') || schemaPublished),
      updated: !!(document.querySelector('[itemprop="dateModified"]') || meta('article:modified_time') || schemaUpdated),
      paragraphs: main?.querySelectorAll('p').length || 0, sentences: (text.match(/[.!?]+(?:\s|$)/g) || []).length, namedEntities: entityNames.size, structuredData,
      faqHowto: /faq|frequently asked|how[ -]to/i.test(headings.map(h => h.textContent).join(' ')) || blocks.some(b => /FAQPage|HowTo/i.test(b.textContent || '')),
      entitySignals: blocks.some(b => /"@type"\s*:\s*(?:\[\s*)?"(?:Organization|Person|Product|Article|NewsArticle|WebPage)"/i.test(b.textContent || '')),
      externalLinks: [...(main?.querySelectorAll<HTMLAnchorElement>('a[href]') || [])].filter(a => { try { return new URL(a.href).origin !== location.origin; } catch { return false; } }).length,
      imagesWithoutAlt: document.querySelectorAll('img:not([alt])').length,
      unoptimizedImages: [...document.images].filter(i => i.loading !== 'lazy' && (!i.hasAttribute('width') || !i.hasAttribute('height'))).length,
      unlabelled, main: !!document.querySelector('main,[role="main"]'), lowContrast, contrastSamples,
      blockingScripts: document.querySelectorAll('head script[src]:not([async]):not([defer]):not([type="module"]),head link[rel="stylesheet"]').length,
      fonts: performance.getEntriesByType('resource').filter(e => /\.(woff2?|ttf|otf)(\?|$)/i.test(e.name)).length,
      lcp: vital?.lcp ?? null, cls: vital?.cls ?? 0, inp: null, viewport: meta('viewport'), links
    };
  });
}
