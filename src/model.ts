export type Category = 'seo' | 'aeo' | 'performance' | 'accessibility' | 'security' | 'mobile';
export type Severity = 'high' | 'medium' | 'low' | 'info';
export interface Finding { id: string; category: Category; severity: Severity; priority: 'high' | 'medium' | 'low'; estimated_effort: 'low' | 'medium' | 'high'; suggested_fix: string; title: string; detail: string; recommendation: string; url: string }
export interface PageResult { url: string; status: number | null; title: string; metrics: Record<string, unknown>; findings: Finding[]; redirects: string[]; screenshot?: string }
export interface Comparison { report: Report; scoresDiff: Record<Category | 'overall' | 'ai_citability', number | null>; onlyPrimary: Finding[] | null; onlyComparison: Finding[] | null; sharedFindingIds: string[] | null }
export interface Report { executive_summary: string[]; schemaVersion: '1.1'; requestedUrl: string; generatedAt: string; durationMs: number; scores: Record<Category | 'overall' | 'ai_citability', number | null>; pages: PageResult[]; prioritizedFixes: Finding[]; warnings: string[]; comparison?: Comparison }
export const categories: Category[] = ['seo', 'aeo', 'performance', 'accessibility', 'security', 'mobile'];

// Scores are heuristic deductions, not Lighthouse or field Core Web Vitals scores.
export function score(findings: Finding[], pageCount: number, mobileComplete = true): Report['scores'] {
  const weights: Record<Severity, number> = { high: 15, medium: 7, low: 3, info: 0 };
  const result = {} as Report['scores'];
  for (const category of categories) {
    const relevant = findings.filter(f => f.category === category);
    result[category] = pageCount && (category !== 'mobile' || mobileComplete) ? Math.max(0, Math.round(100 - relevant.reduce((n, f) => n + weights[f.severity], 0) / pageCount)) : null;
  }
  const values = categories.map(c => result[c]).filter((x): x is number => x !== null);
  result.overall = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  result.ai_citability = null;
  return result;
}
export function prioritize(findings: Finding[]): Finding[] {
  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  return [...findings].sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id) || a.url.localeCompare(b.url));
}
export function normalizeUrl(value: string): string {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('URL must be an HTTP(S) URL without credentials');
  u.hash = '';
  return u.href;
}
