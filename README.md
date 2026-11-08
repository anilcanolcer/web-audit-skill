# web-audit-skill

![Web Audit logo](assets/logo-dark.png)

A browser-based, agent-friendly website audit for technical SEO, AI-answer readiness, performance signals, accessibility, security headers, and mobile layout.

## For complete beginners

1. Install [Node.js](https://nodejs.org/) version 20 or newer, which includes npm.
2. Download and unzip this project, then open a terminal in the unzipped project folder (the folder containing `package.json`).
3. Copy and run these commands, replacing the example URL with a site you have permission to audit:

```sh
npm install
npm run build
node dist/cli.js https://example.com
```

The first command downloads the browser used by the audit and can take a few minutes. When the audit finishes, open `audit-result/report.html` in your browser. The same folder contains `report.md` and `report.json`. A published npm package would also allow the shorter `npx` command below; publishing is still required.

### Example Markdown report

This excerpt is from an actual run against a local test fixture; scores and findings will differ for your site:

```markdown
## Executive Summary

- Audited 1 page(s); overall score 86/100 and AI citability 58/100.
- 13 finding(s), including 1 high-priority issue(s).
- First priority: Limited readable text (http://127.0.0.1:18766/).
- Scores are heuristics; review page context and coverage warnings before acting.

### HIGH: Limited readable text

- Page: http://127.0.0.1:18766/
- Estimated effort: high
- Evidence: 8 visible words in the main content sample.
- Suggested fix: Add useful, specific content answering the page’s primary question.
```

## Quick start

Requires Node.js 20 or newer and a supported Playwright Chromium platform. The first install downloads Chromium, which takes time and disk space. In Linux containers, Chromium may also require OS packages; see [Playwright's system dependencies](https://playwright.dev/docs/browsers#install-system-dependencies).

In managed environments, `WEB_AUDIT_CHROMIUM_EXECUTABLE` can point to an existing compatible Chromium executable. Playwright works best with its bundled version; other versions are not guaranteed to work.

```sh
npx web-audit-skill https://example.com
npx web-audit-skill https://example.com --pages 3 --mobile --screenshot --output ./audit-result
```

Or install globally:

```sh
npm install -g web-audit-skill
web-audit https://example.com --format json > report-stdout.json
```

The package must be published under this name before the npx and npm commands work. For local development use `npm install`, `npm test`, then `node dist/cli.js https://example.com`.

## Options

| Option | Meaning |
| --- | --- |
| `--pages 1-10` | Maximum successfully audited pages; default 3. Same origin, at most two link levels from the start. |
| `--format json\|markdown\|html\|both` | Files to write and stdout mode; default both writes all three. |
| `--output ./audit-result` | Output directory; created as needed. |
| `--mobile` | Also render at a 390px mobile viewport and check overflow. |
| `--screenshot` | Save full-page PNGs; with mobile, also save mobile PNGs. |
| `--timeout 30` | Per navigation/request timeout in seconds, maximum 300; not a whole-run deadline. |

`report.json` contains the complete report, `report.md` is the readable version, and `report.html` is a self-contained visual report with no external assets. With `--format json`, stdout contains only the complete JSON report; progress and errors go to stderr. With `both` or `html`, stdout contains a small JSON summary; Markdown mode prints Markdown. Exit status is nonzero for invalid arguments, launch errors, or when no page was audited; a completed audit can still include warnings and failed individual pages. Use the report's `warnings` and `pages` to check coverage.

Example summary (scores shown only as an illustration):

```json
{ "executive_summary": ["Audited 1 page(s); overall score 85/100 and AI citability 64/100."], "requestedUrl": "https://example.com/", "scores": { "seo": 74, "aeo": 70, "performance": 93, "accessibility": 100, "security": 75, "mobile": 100, "overall": 85, "ai_citability": 64 }, "pagesAudited": 1, "findings": 8, "warnings": [], "output": "/path/to/audit-result" }
```

Example finding from `report.json` (excerpt):

```json
{ "id": "provenance-author", "priority": "medium", "estimated_effort": "medium", "suggested_fix": "Add a visible byline and matching author metadata where relevant.", "url": "https://example.com/article" }
```

## Agent skill and tool integration

Copy `SKILL.md` and `tool.schema.json` into a `web-audit-skill` directory under your agent's skills location (for example, `~/.claude/skills/` or `~/.agents/skills/` where supported). Consult your agent's documentation for its current discovery path; Cursor can also use the instructions as a project rule. Install this package globally, or allow the skill to invoke `npx`. The skill describes how to interpret the results and treats audited pages as untrusted data.

For tool adapters, `tool.schema.json` defines input parameters. Execute `web-audit <url> --format json` with arguments passed as an array (never through an interpolated shell), then parse stdout. Report version 1.1 adds `executive_summary`, `scores.ai_citability`, page-level `metrics.schema_quality` and `metrics.ai_citability`, and `priority`, `estimated_effort`, and `suggested_fix` on each finding; existing `severity` and `recommendation` fields remain for compatibility. The executive summary has at most five strings. Each finding also has a stable check ID, category, evidence, and page URL. This package supplies a CLI and skill, not an MCP server; an MCP host can wrap the CLI using this schema.

## What the checks mean

- SEO: title, description, headings, canonical, document language, JSON-LD syntax, social metadata, hreflang inventory, robots directives, sitemap discovery, sampled internal links and document redirect chains.
- AEO: visible word count, heading hierarchy, independent author and date signals, source links, and JSON-LD completeness for FAQPage, HowTo, Article (including NewsArticle and BlogPosting), and Organization. A schema score is the percentage of selected checks passed across detected items; `null` means that type was absent, not that it passed. These checks do not validate all schema rules, facts, dates, or search eligibility. JSON-LD graphs, arrays, and nested objects are inspected. Only add types that accurately describe the page.
- AI citability: a 0–100 heuristic, reported separately from the overall category average. Four components contribute at most 25 points each: sentence-length and paragraph signals (clarity); unique named entities in selected JSON-LD types per word (entity signals); content length, author, date and source links (context); and H1, heading count and heading order (structure). Sentence splitting and word counting are simple approximations, and structured-data names are not full entity recognition. An absent signal is not proof of a problem. This score does not predict an AI citation or assess factual correctness; short or non-article pages may appropriately score low.
- Performance: short synthetic LCP candidate and layout-shift observations, plus image, script, stylesheet and font hints. INP requires interaction and is not measured. This is not Lighthouse or field Core Web Vitals.
- Accessibility: missing alt attributes, heading jumps, basic label and main-landmark checks, and a limited text contrast sample. The contrast approximation does not account for all backgrounds, font sizes, or visual effects; verify with dedicated tools and manual testing.
- Security: selected response headers. Mobile: viewport metadata and optional horizontal overflow.

Scores start at 100 per category and deduct 15, 7, or 3 points per high, medium, or low finding, averaged over audited pages and bounded at zero. Overall is the unweighted mean of available category scores. Mobile is `null` unless `--mobile` was requested and every mobile check completed; the viewport meta check still runs. A high score is not a compliance, security, search ranking, or performance certification. Checks may be inapplicable to some pages. Informational findings do not deduct points. Scores are `null` when no page was audited.

The crawler uses the `web-audit-skill` user agent, fetches `/robots.txt` before visiting pages, honors matching rules on every document navigation and sampled link, and fails closed if robots cannot be retrieved except for HTTP 404/410. Redirects for audited documents are restricted to allowed URLs on the initial origin. Subresources may load from other origins as part of browser rendering. Sitemap detection uses robots directives or a HEAD request to `/sitemap.xml`; a failed HEAD is not conclusive. Sampled internal links use HEAD, do not follow redirects, and may have server-specific behavior. Robots rules do not grant authorization: audit only sites you are permitted to access. This tool can access network destinations reachable from its host; do not expose it as an unauthenticated service or run it on untrusted URLs without network isolation.

The 45-second target for three pages is best effort, not a guarantee: page load time, first browser installation, site responses, mobile rendering, and link checks affect runtime. For faster runs reduce `--pages` and omit screenshots/mobile. A page is observed shortly after DOM content loads, so late JavaScript, lazy content, and visual shifts can be missed.

## Development and license

Run `npm test` to build and execute the core tests. `npm pack` produces a publishable archive after building; inspect package contents and confirm the package name is available before publishing. MIT licensed; see [LICENSE](LICENSE).

SitePulse or other monitoring systems can invoke the JSON mode on a schedule and store successive reports, but this package does not include monitoring or an integration service.
