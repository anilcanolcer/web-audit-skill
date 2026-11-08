import test from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../dist/model.js';
import { compareReports } from '../dist/compare.js';
import { markdown, html } from '../dist/report.js';
const finding = id => ({ id, category:'seo', severity:'medium', priority:'medium', estimated_effort:'low', suggested_fix:'Fix', title:id, detail:'evidence', recommendation:'Fix', url:'https://a.example' });
const report = (url, findings, pages = [{}]) => ({ executive_summary: ['Summary'], schemaVersion:'1.1', requestedUrl:url, generatedAt:'now', durationMs:1, scores:score(findings,pages.length,false), pages, prioritizedFixes:findings, warnings:[] });
test('compares scores and unique check IDs with a defined direction', () => {
  const a = report('https://a.example',[finding('a'),finding('shared')]);
  const b = report('https://b.example',[finding('b'),finding('shared'),finding('shared')]);
  const c = compareReports(a,b);
  assert.equal(c.scoresDiff.seo,-7);
  assert.equal(c.scoresDiff.mobile,null);
  assert.deepEqual(c.onlyPrimary.map(x=>x.id),['a']);
  assert.deepEqual(c.onlyComparison.map(x=>x.id),['b']);
  assert.deepEqual(c.sharedFindingIds,['shared']);
  a.comparison=c;
  assert.match(markdown(a), /Comparison minus primary/i);
  assert.match(html(a), /Only on comparison/);
});
test('does not infer finding differences from a failed audit', () => {
  const a=report('https://a.example',[finding('a')]);
  const b=report('https://b.example',[],[]);
  const c=compareReports(a,b);
  assert.equal(c.scoresDiff.seo,null);
  assert.equal(c.onlyPrimary,null);
  assert.equal(c.onlyComparison,null);
});
