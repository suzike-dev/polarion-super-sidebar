import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = 'C:/Users/Lenovo/Documents/Codex/2026-08-26/https-polarion-pufafen-com-polarion-project/outputs/polarion-mcp-server';
const out = path.resolve(import.meta.dirname, '../.research/s1');
const { Client } = await import(pathToFileURL(path.join(root, 'node_modules/@modelcontextprotocol/client/dist/index.mjs')));
const { StdioClientTransport } = await import(pathToFileURL(path.join(root, 'node_modules/@modelcontextprotocol/client/dist/stdio.mjs')));
const config = JSON.parse(await fs.readFile('C:/Users/Lenovo/.claude.json', 'utf8'));
const selected = config.mcpServers?.['polarion-mcp-server'];
if (!selected || selected.disabled) throw Error('Configured Polarion MCP missing');
const transport = new StdioClientTransport({ command: selected.command, args: selected.args, env: { ...process.env, ...selected.env, POLARION_WRITES_ENABLED: 'false', POLARION_NODE_PATH: process.execPath }, stderr: 'ignore' });
const client = new Client({ name: 'polarion-sidebar-s1-readonly', version: '0.1.0' });
await fs.mkdir(out, { recursive: true });
const parse = result => { if (result.isError) throw Error('MCP request failed (raw diagnostics suppressed)'); return result.structuredContent ?? JSON.parse(result.content.find(c => c.type === 'text').text); };
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  await fs.writeFile(path.join(out, 'mcp-tools.json'), JSON.stringify(tools, null, 2));
  const call = async (name, args) => {
    if (tools.find(t => t.name === name)?.annotations?.readOnlyHint !== true) throw Error('Probe requires declared read-only operation: ' + name);
    return parse(await client.callTool({ name, arguments: { ...args, response_format: 'json' } }, { timeout: 120000 }));
  };
  const status = await call('polarion_status', {});
  if (status.writes_enabled !== false || !status.authenticated) throw Error('Read-only authenticated connection not confirmed');
  const projects = await call('polarion_list_accessible_projects', { include_inactive: true, limit: 2000 });
  const candidates = projects.projects.filter(p => /sandbox|test/i.test([p.id,p.name,p.location].join(' '))).map(p => ({ id:p.id, name:p.name, location:p.location }));
  const result = { at: new Date().toISOString(), authenticated: true, writes_enabled: false, tool_count: tools.length, projects: projects.returned_count, sandbox_candidates: candidates, write_calls: 0 };
  await fs.writeFile(path.join(out, 'polarion-readonly.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if(process.argv[2]==='samples') {
    const doc=await call('polarion_get_document',{project_id:'45_SPE25_BQ1_TM_002',location:'Design/Software Requirement Specification SWR'});
    const item=await call('polarion_get_work_item',{project_id:'45_SPE25_BQ1_TM_002',work_item_id:'SPE-526'});
    const imageItem=await call('polarion_get_work_item',{project_id:'45_SPE25_BQ1_TM_002',work_item_id:'SPE-520'});
    const actions=await call('polarion_list_work_item_actions',{project_id:'45_SPE25_BQ1_TM_002',work_item_id:'SPE-526'});
    const testDocs=await call('polarion_list_documents',{project_id:'SPE_TEST_001',limit:100});
    await fs.writeFile(path.join(out,'polarion-samples-private.json'),JSON.stringify({at:new Date().toISOString(),doc,item,imageItem,actions,testDocs},null,2));
    console.log(JSON.stringify({samples:'captured',document_keys:Object.keys(doc),item_keys:Object.keys(item),action_keys:Object.keys(actions),test_documents:testDocs.documents?.map(d=>({id:d.id,location:d.location,title:d.title}))}));
  }
  const wsdl = await fetch(`${selected.env.POLARION_BASE_URL.replace(/\/$/, '')}/ws/services/TrackerWebService?wsdl`, { signal: AbortSignal.timeout(30000) });
  const xml = await wsdl.text();
  const operations = [...new Set([...xml.matchAll(/<(?:\w+:)?operation\s+name="([^"]+)"/g)].map(m=>m[1]))];
  const summary = { at: new Date().toISOString(), status: wsdl.status, operations: operations.length, document_operations: operations.filter(n=>/module|document|workitemin/i.test(n)) };
  if (operations.length) await fs.writeFile(path.join(out, 'TrackerWebService.wsdl'), xml);
  await fs.writeFile(path.join(out, 'polarion-wsdl.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} finally { await client.close(); }
