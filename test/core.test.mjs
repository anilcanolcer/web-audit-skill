import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, score, prioritize } from '../dist/model.js';
import { html, markdown } from '../dist/report.js';
import { assessSchemas, citability } from '../dist/aeo.js';

test('normalizes URLs and rejects unsafe schemes and credentials', () => {
  assert.equal(normalizeUrl('https://example.com/a#section'), 'https://example.com/a');
  assert.throws(() => normalizeUrl('file:///etc/passwd'));
  assert.throws(() => normalizeUrl('https://user:pass@example.com'));
});
test('deductions are averaged across pages and bounded', () => {
  const f = { id: 'x', category: 'seo', severity: 'high', title: 'X', detail: 'X', recommendation: 'Fix', url: 'https://example.com/' };
  assert.equal(score([f], 1).seo, 85);
  assert.equal(score([f], 2).seo, 93);
  assert.equal(score(Array(20).fill(f), 1).seo, 0);
  assert.equal(score([], 0).overall, null);
  assert.equal(score([], 1, false).mobile, null);
  assert.equal(score([], 1, false).overall, 100);
  assert.equal(prioritize([{ ...f, severity: 'low' }, f])[0].severity, 'high');
});
test('markdown includes coverage warnings', () => {
  const r = { executive_summary: ['No pages audited'], requestedUrl: 'https://example.com', generatedAt: 'now', pages: [], scores: score([], 0), prioritizedFixes: [], warnings: ['Blocked'] };
  assert.match(markdown(r), /Blocked/);
  assert.match(markdown(r), /Executive Summary/);
  assert.match(html({ ...r, requestedUrl: '<script>alert(1)</script>' }), /&lt;script&gt;/);
  assert.doesNotMatch(html({ ...r, requestedUrl: '<script>alert(1)</script>' }), /<script>/);
});
test('assesses schemas in graphs and type arrays without treating absence as failure', () => {
  const result = assessSchemas([{ '@graph': [
    { '@type': ['Thing', 'FAQPage'], mainEntity: [{ '@type': 'Question', name: 'Why?', acceptedAnswer: { '@type': 'Answer', text: 'Because.' } }] },
    { '@type': 'Article', headline: 'Title', author: { name: 'A' }, datePublished: '2026-01-01' },
    { '@type': 'HowTo', name: 'Guide', step: [{ text: 'Do it.' }] },
    { '@type': 'Organization', name: 'Acme' }
  ] }]);
  assert.equal(result.FAQPage.score, 100);
  assert.equal(result.Article.score, 75);
  assert.deepEqual(result.Article.missing, ['named publisher']);
  assert.equal(result.HowTo.score, 100);
  assert.equal(result.Organization.score, 33);
  assert.equal(assessSchemas([]).FAQPage.score, null);
});
test('citability scores improve with identifiable context and structure', () => {
  const thin = { words: 20, sentences: 2, headings: 1, skippedHeadings: 0, h1: 1, paragraphs: 1, namedEntities: 0, author: false, published: false, updated: false, externalLinks: 0 };
  const rich = { ...thin, words: 300, sentences: 20, headings: 4, paragraphs: 4, namedEntities: 3, author: true, published: true, externalLinks: 1 };
  assert.ok(citability(rich).score > citability(thin).score);
  assert.equal(citability(rich).score, 100);
  assert.equal(citability(rich).evidence.namedEntitySignalsPer100Words, 1);
});
