import type { Comparison, Finding, Report } from './model.js';

/** Score difference is comparison minus primary. Findings are compared by check ID, not page URL. */
export function compareReports(primary: Report, other: Report): Comparison {
  const scoresDiff = {} as Comparison['scoresDiff'];
  for (const key of Object.keys(primary.scores) as (keyof Report['scores'])[]) {
    const a = primary.scores[key], b = other.scores[key];
    scoresDiff[key] = a === null || b === null ? null : b - a;
  }
  const unique = (items: Finding[]) => [...new Map(items.map(f => [f.id, f])).values()];
  const a = unique(primary.prioritizedFixes), b = unique(other.prioritizedFixes);
  const aIds = new Set(a.map(f => f.id)), bIds = new Set(b.map(f => f.id));
  const coverage = primary.pages.length > 0 && other.pages.length > 0;
  return { report: other, scoresDiff, onlyPrimary: coverage ? a.filter(f => !bIds.has(f.id)) : null, onlyComparison: coverage ? b.filter(f => !aIds.has(f.id)) : null, sharedFindingIds: coverage ? [...aIds].filter(id => bIds.has(id)).sort() : null };
}
