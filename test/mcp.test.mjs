import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('stdio MCP handshake, tool discovery, validation and audit error', async () => {
  const server = createServer((req,res) => { res.writeHead(200, {'content-type':'text/plain'}); res.end('User-agent: *\nDisallow: /\n'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const output=await mkdtemp(join(tmpdir(),'web-audit-mcp-'));
  const child=spawn(process.execPath,['dist/cli.js','mcp'],{stdio:['pipe','pipe','pipe']});
  const lines=createInterface({ input:child.stdout })[Symbol.asyncIterator]();
  let id=0;
  async function call(method,params={}) { const n=++id; child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n'); const line=await lines.next(); assert.equal(line.done,false); const result=JSON.parse(line.value); assert.equal(result.id,n); return result; }
  try {
    const init=await call('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}});
    assert.equal(init.result.protocolVersion,'2025-11-25');
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    const list=await call('tools/list'); assert.equal(list.result.tools[0].name,'web_audit'); assert.ok(list.result.tools[0].inputSchema.properties.compare);
    const invalid=await call('tools/call',{name:'web_audit',arguments:{url:'file:///secret'}}); assert.equal(invalid.result.isError,true);
    const port=server.address().port;
    const blocked=await call('tools/call',{name:'web_audit',arguments:{url:`http://127.0.0.1:${port}/`,output}});
    assert.equal(blocked.result.isError,true); assert.equal(blocked.result.structuredContent.pages.length,0);
  } finally { child.stdin.end(); child.kill(); server.close(); await rm(output,{recursive:true,force:true}); }
});

test('MCP returns a successful two-site browser audit', { skip: !process.env.WEB_AUDIT_CHROMIUM_EXECUTABLE }, async () => {
  const server=createServer((req,res) => {
    if (req.url === '/robots.txt' || req.url === '/sitemap.xml') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'content-type':'text/html'}); res.end('<html lang="en"><head><title>Audit fixture</title></head><body><main><h1>Example</h1><p>Test content.</p></main></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const output=await mkdtemp(join(tmpdir(),'web-audit-mcp-ok-'));
  const child=spawn(process.execPath,['dist/mcp.js'],{stdio:['pipe','pipe','pipe'],env:process.env});
  const lines=createInterface({ input:child.stdout })[Symbol.asyncIterator]();
  async function call(id,method,params) { child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n'); return JSON.parse((await lines.next()).value); }
  try {
    await call(1,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}});
    const url=`http://127.0.0.1:${server.address().port}`;
    const r=await call(2,'tools/call',{name:'web_audit',arguments:{url:url+'/a',compare:url+'/b',pages:1,output}});
    assert.equal(r.result.isError,undefined);
    assert.equal(r.result.structuredContent.pages.length,1);
    assert.equal(r.result.structuredContent.comparison.report.pages.length,1);
    assert.equal(typeof r.result.structuredContent.comparison.scoresDiff.overall,'number');
  } finally { child.stdin.end(); child.kill(); server.close(); await rm(output,{recursive:true,force:true}); }
});
