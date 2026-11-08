#!/usr/bin/env node
import { resolve } from 'node:path';
import { markdown } from './report.js';
import { runAudit, writeReports } from './run.js';
import { normalizeUrl } from './model.js';
const help = `Usage: web-audit <url> [options]

  --pages <1-10>             Maximum audited pages (default: 3)
  --format <json|markdown|html|both>  Report format (default: both)
  --output <directory>       Output directory (default: ./audit-result)
  --mobile                   Also inspect a mobile viewport
  --compare <url>            Audit a second site and compare scores
  --screenshot               Save full-page screenshots
  --timeout <seconds>        Navigation/request timeout (default: 30)
  --help                     Show this help

Both writes JSON, Markdown and HTML reports. JSON prints the full report to
stdout; both and html print a JSON summary. Progress goes to stderr.`;
async function main() {
    const args = process.argv.slice(2);
    if (args[0] === 'mcp') {
        if (args.length > 1)
            throw new Error('The mcp command takes no arguments');
        const { startMcp } = await import('./mcp.js');
        await startMcp();
        return;
    }
    if (args.includes('--help') || args.includes('-h')) {
        console.log(help);
        return;
    }
    let input = '';
    let format = 'both';
    let compareUrl;
    const options = { pages: 3, output: resolve('audit-result'), mobile: false, screenshot: false, timeout: 30, progress: s => console.error(s) };
    const value = (index) => { const v = args[index + 1]; if (!v || v.startsWith('--'))
        throw new Error(`Missing value for ${args[index]}`); return v; };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--mobile')
            options.mobile = true;
        else if (arg === '--screenshot')
            options.screenshot = true;
        else if (arg === '--pages')
            options.pages = Number(value(i++));
        else if (arg === '--timeout')
            options.timeout = Number(value(i++));
        else if (arg === '--output')
            options.output = resolve(value(i++));
        else if (arg === '--format')
            format = value(i++);
        else if (arg === '--compare')
            compareUrl = value(i++);
        else if (arg.startsWith('-'))
            throw new Error(`Unknown option: ${arg}`);
        else if (!input)
            input = arg;
        else
            throw new Error(`Unexpected argument: ${arg}`);
    }
    if (!input)
        throw new Error('A URL is required. Run web-audit --help.');
    normalizeUrl(input);
    if (compareUrl)
        normalizeUrl(compareUrl);
    if (!Number.isInteger(options.pages) || options.pages < 1 || options.pages > 10)
        throw new Error('--pages must be an integer from 1 to 10');
    if (!Number.isFinite(options.timeout) || options.timeout <= 0 || options.timeout > 300)
        throw new Error('--timeout must be a number greater than 0 and at most 300 seconds');
    if (!['json', 'markdown', 'html', 'both'].includes(format))
        throw new Error('--format must be json, markdown, html, or both');
    const report = await runAudit(input, compareUrl, options);
    await writeReports(report, options.output, format);
    if (format === 'json')
        console.log(JSON.stringify(report, null, 2));
    else if (format === 'markdown')
        console.log(markdown(report));
    else
        console.log(JSON.stringify({ executive_summary: report.executive_summary, requestedUrl: report.requestedUrl, scores: report.scores, pagesAudited: report.pages.length, findings: report.prioritizedFixes.length, warnings: report.warnings, ...(report.comparison ? { comparison: { requestedUrl: report.comparison.report.requestedUrl, scores: report.comparison.report.scores, scoresDiff: report.comparison.scoresDiff, warnings: report.comparison.report.warnings } } : {}), output: options.output }, null, 2));
    if (!report.pages.length || (report.comparison && !report.comparison.report.pages.length))
        process.exitCode = 1;
}
main().catch((error) => { console.error(`web-audit: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
