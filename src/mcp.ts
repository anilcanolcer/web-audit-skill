#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { normalizeUrl } from './model.js';
import { runAudit, writeReports, type Format } from './run.js';

type JsonObject = Record<string, unknown>;
const obj = (v: unknown): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v);
const versions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export async function startMcp(): Promise<void> {
  const schema = JSON.parse(await readFile(new URL('../tool.schema.json', import.meta.url), 'utf8'));
  const send = (message: unknown) => process.stdout.write(JSON.stringify(message) + '\n');
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  for await (const line of lines) {
    let request: unknown;
    try { request = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    if (!obj(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || ('id' in request && !(typeof request.id === 'string' || typeof request.id === 'number' || request.id === null))) { send({ jsonrpc: '2.0', id: obj(request) && 'id' in request ? request.id : null, error: { code: -32600, message: 'Invalid Request' } }); continue; }
    if (!('id' in request)) continue;
    const reply = (result: unknown) => send({ jsonrpc: '2.0', id: request.id, result });
    const error = (code: number, message: string) => send({ jsonrpc: '2.0', id: request.id, error: { code, message } });
    const params = obj(request.params) ? request.params : {};
    if (request.method === 'initialize') {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      reply({ protocolVersion: versions.includes(requested) ? requested : versions[0], capabilities: { tools: {} }, serverInfo: { name: 'web-audit-skill', version: '1.2.0' } });
    } else if (request.method === 'ping') reply({});
    else if (request.method === 'tools/list') reply({ tools: [{ name: 'web_audit', description: 'Audit one or two websites with Chromium. Scores are heuristic; inspect warnings.', inputSchema: schema }] });
    else if (request.method === 'tools/call') {
      if (params.name !== 'web_audit') { error(-32602, 'Unknown tool'); continue; }
      try {
        const args = params.arguments === undefined ? {} : params.arguments;
        if (!obj(args)) throw new Error('Arguments must be an object');
        const allowed = new Set(['url', 'compare', 'pages', 'format', 'mobile', 'screenshot', 'timeout', 'output']);
        if (Object.keys(args).some(k => !allowed.has(k))) throw new Error('Unknown argument');
        if (typeof args.url !== 'string') throw new Error('url is required and must be a string');
        normalizeUrl(args.url);
        if (args.compare !== undefined && typeof args.compare !== 'string') throw new Error('compare must be a URL string');
        if (typeof args.compare === 'string') normalizeUrl(args.compare);
        const pages = args.pages ?? 3, timeout = args.timeout ?? 30, format = args.format ?? 'json';
        if (typeof pages !== 'number' || !Number.isInteger(pages) || pages < 1 || pages > 10) throw new Error('pages must be an integer between 1 and 10');
        if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0 || timeout > 300) throw new Error('timeout must be greater than 0 and at most 300');
        if (typeof format !== 'string' || !['json','markdown','html','both'].includes(format)) throw new Error('Invalid format');
        if (args.mobile !== undefined && typeof args.mobile !== 'boolean') throw new Error('mobile must be a boolean');
        if (args.screenshot !== undefined && typeof args.screenshot !== 'boolean') throw new Error('screenshot must be a boolean');
        if (args.output !== undefined && typeof args.output !== 'string') throw new Error('output must be a string');
        const output = resolve(typeof args.output === 'string' ? args.output : 'audit-result');
        const report = await runAudit(args.url, args.compare as string | undefined, { pages, timeout, mobile: args.mobile === true, screenshot: args.screenshot === true, output });
        await writeReports(report, output, format as Format);
        reply({ content: [{ type: 'text', text: JSON.stringify(report) }], structuredContent: report, ...(!report.pages.length || (report.comparison && !report.comparison.report.pages.length) ? { isError: true } : {}) });
      } catch (e) { reply({ content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true }); }
    } else error(-32601, 'Method not found');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) startMcp().catch(e => { console.error(e); process.exitCode = 1; });
