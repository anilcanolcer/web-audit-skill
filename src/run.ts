import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { audit, type Options } from './audit.js';
import { compareReports } from './compare.js';
import { html, markdown } from './report.js';
import { score, type Report } from './model.js';

export type Format = 'json' | 'markdown' | 'html' | 'both';
export async function runAudit(url: string, compareUrl: string | undefined, options: Options): Promise<Report> {
  const run = async (target: string, runOptions: Options): Promise<Report> => {
    try { return await audit(target, runOptions); }
    catch (e) { return { executive_summary: ['No pages audited; scores are unavailable.'], schemaVersion: '1.1', requestedUrl: target, generatedAt: new Date().toISOString(), durationMs: 0, scores: score([], 0), pages: [], prioritizedFixes: [], warnings: [`Audit failed: ${e instanceof Error ? e.message : String(e)}`] }; }
  };
  const primary = await run(url, options);
  if (compareUrl) {
    const other = await run(compareUrl, { ...options, output: join(options.output, 'comparison') });
    for (const page of other.pages) if (page.screenshot) page.screenshot = `comparison/${page.screenshot}`;
    primary.comparison = compareReports(primary, other);
    if (other.pages.length === 0) primary.warnings.push('Comparison site could not be audited; see comparison.report.warnings.');
    if (primary.pages.length === 0) primary.warnings.push('Primary site could not be audited; finding differences are unavailable.');
  }
  return primary;
}
export async function writeReports(report: Report, output: string, format: Format): Promise<void> {
  await mkdir(output, { recursive: true });
  if (format === 'json' || format === 'both') await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  if (format === 'markdown' || format === 'both') await writeFile(join(output, 'report.md'), markdown(report));
  if (format === 'html' || format === 'both') await writeFile(join(output, 'report.html'), html(report));
}
