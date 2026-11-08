export type SchemaKind = 'FAQPage' | 'HowTo' | 'Article' | 'Organization';
export interface SchemaAssessment { count: number; score: number | null; missing: string[] }
const kinds: SchemaKind[] = ['FAQPage', 'HowTo', 'Article', 'Organization'];
type Node = Record<string, unknown>;
const object = (v: unknown): v is Node => !!v && typeof v === 'object' && !Array.isArray(v);
const present = (v: unknown): boolean => typeof v === 'string' ? v.trim().length > 0 : Array.isArray(v) ? v.some(present) : object(v) ? Object.keys(v).length > 0 : false;
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : v == null ? [] : [v];
const typeIs = (n: Node, type: string): boolean => list(n['@type']).some(t => typeof t === 'string' && (t === type || t.endsWith('/' + type)));
const named = (v: unknown): boolean => list(v).some(x => typeof x === 'string' ? !!x.trim() : object(x) && present(x.name));
export function assessSchemas(blocks: unknown[]): Record<SchemaKind, SchemaAssessment> {
  const nodes: Node[] = [];
  const visit = (x: unknown): void => { if (Array.isArray(x)) { x.forEach(visit); return; } if (!object(x)) return; nodes.push(x); Object.values(x).forEach(visit); };
  blocks.forEach(visit);
  const rules: Record<SchemaKind, [string, (n: Node) => boolean][]> = {
    FAQPage: [['all mainEntity questions have names and accepted answer text', n => { const questions = list(n.mainEntity); return questions.length > 0 && questions.every(q => object(q) && typeIs(q, 'Question') && present(q.name) && list(q.acceptedAnswer).some(a => object(a) && present(a.text))); }]],
    HowTo: [['name', n => present(n.name)], ['all steps have text or name', n => { const steps = list(n.step); return steps.length > 0 && steps.every(s => typeof s === 'string' ? !!s.trim() : object(s) && (present(s.text) || present(s.name))); }]],
    Article: [['headline', n => present(n.headline)], ['named author', n => named(n.author)], ['datePublished', n => present(n.datePublished)], ['named publisher', n => named(n.publisher)]],
    Organization: [['name', n => present(n.name)], ['url', n => present(n.url)], ['logo', n => present(n.logo)]]
  };
  const out = {} as Record<SchemaKind, SchemaAssessment>;
  for (const kind of kinds) {
    const matches = nodes.filter(n => typeIs(n, kind) || (kind === 'Article' && (typeIs(n, 'NewsArticle') || typeIs(n, 'BlogPosting'))));
    const missing = new Set<string>(); let passed = 0;
    for (const node of matches) for (const [label, check] of rules[kind]) { if (check(node)) passed++; else missing.add(label); }
    out[kind] = { count: matches.length, score: matches.length ? Math.round(100 * passed / (matches.length * rules[kind].length)) : null, missing: [...missing] };
  }
  return out;
}
export interface CitabilityInput { words: number; sentences: number; headings: number; skippedHeadings: number; h1: number; paragraphs: number; namedEntities: number; author: boolean; published: boolean; updated: boolean; externalLinks: number }
export function citability(i: CitabilityInput) {
  // Transparent indicators, not semantic entity recognition or a prediction of AI citations.
  const averageSentenceWords = i.sentences ? i.words / i.sentences : null;
  const clarity = i.words === 0 ? 0 : (averageSentenceWords !== null && averageSentenceWords <= 25 ? 15 : 7) + (i.paragraphs >= 2 ? 10 : 3);
  const entity = Math.min(25, i.namedEntities * 8 + (i.namedEntities > 0 && i.words > 0 && i.namedEntities / i.words >= 0.005 ? 1 : 0));
  const context = (i.words >= 200 ? 10 : i.words >= 80 ? 5 : 0) + (i.author ? 5 : 0) + (i.published || i.updated ? 5 : 0) + (i.externalLinks ? 5 : 0);
  const structure = (i.h1 === 1 ? 8 : 0) + (i.headings >= 3 ? 10 : i.headings >= 2 ? 5 : 0) + (i.skippedHeadings === 0 && i.headings > 0 ? 7 : 0);
  return { score: Math.min(100, clarity + entity + context + structure), components: { clarity, entity, context, structure }, evidence: { averageSentenceWords: averageSentenceWords === null ? null : Math.round(averageSentenceWords * 10) / 10, namedEntitySignals: i.namedEntities, namedEntitySignalsPer100Words: i.words ? Math.round(i.namedEntities / i.words * 1000) / 10 : 0 } };
}
