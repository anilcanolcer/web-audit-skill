export const categories = ['seo', 'aeo', 'performance', 'accessibility', 'security', 'mobile'];
// Scores are heuristic deductions, not Lighthouse or field Core Web Vitals scores.
export function score(findings, pageCount, mobileComplete = true) {
    const weights = { high: 15, medium: 7, low: 3, info: 0 };
    const result = {};
    for (const category of categories) {
        const relevant = findings.filter(f => f.category === category);
        result[category] = pageCount && (category !== 'mobile' || mobileComplete) ? Math.max(0, Math.round(100 - relevant.reduce((n, f) => n + weights[f.severity], 0) / pageCount)) : null;
    }
    const values = categories.map(c => result[c]).filter((x) => x !== null);
    result.overall = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
    result.ai_citability = null;
    return result;
}
export function prioritize(findings) {
    const rank = { high: 0, medium: 1, low: 2, info: 3 };
    return [...findings].sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id) || a.url.localeCompare(b.url));
}
export function normalizeUrl(value) {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
        throw new Error('URL must be an HTTP(S) URL without credentials');
    u.hash = '';
    return u.href;
}
