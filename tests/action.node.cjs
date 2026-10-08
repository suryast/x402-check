'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const v2 = { x402Version: 2, resource: { url: 'https://api.example.com/premium-data', description: 'Access to premium market data', mimeType: 'application/json' }, accepts: [{ scheme: 'exact', network: 'eip155:84532', amount: '10000', asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', payTo: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C', maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' } }], extensions: {} };
const v1 = { x402Version: 1, accepts: [{ scheme: 'exact', network: 'base-mainnet', maxAmountRequired: '10000', resource: 'https://example.com/api', description: 'Legacy example', mimeType: 'application/json', payTo: '0x123', maxTimeoutSeconds: 60 }] };
const encoded = x => Buffer.from(JSON.stringify(x)).toString('base64');
test('actual Action entry point validates v2/v1 headers and output/failure semantics', async t => {
  const badNetwork = structuredClone(v2); badNetwork.accepts[0].network = 'base-mainnet';
  const badAmount = structuredClone(v2); badAmount.accepts[0].amount = '-1';
  const routes = {
    '/v2': [402, { 'PAYMENT-REQUIRED': encoded(v2) }],
    '/v1': [402, { 'X-PAYMENT-REQUIRED': encoded(v1) }],
    '/both': [402, { 'PAYMENT-REQUIRED': encoded(v2), 'X-PAYMENT-REQUIRED': encoded({}) }],
    '/priority': [402, { 'PAYMENT-REQUIRED': 'malformed', 'X-PAYMENT-REQUIRED': encoded(v1) }],
    '/plain': [402, {}], '/object': [402, { 'X-PAYMENT-REQUIRED': encoded({}) }],
    '/version': [402, { 'PAYMENT-REQUIRED': encoded({ ...v2, x402Version: 3 }) }],
    '/network': [402, { 'PAYMENT-REQUIRED': encoded(badNetwork) }],
    '/amount': [402, { 'PAYMENT-REQUIRED': encoded(badAmount) }],
    '/ok': [200, { 'PAYMENT-REQUIRED': encoded(v2) }],
  };
  const server = http.createServer((req, res) => { const [status, headers] = routes[req.url]; res.writeHead(status, headers); res.end('fixture'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'x402-action-')); fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function run(paths, fail = 'true') {
    const output = path.join(dir, `output-${Math.random()}`); fs.writeFileSync(output, '', { mode: 0o600 });
    const child = spawn(process.execPath, [path.resolve(__dirname, '../action/index.js')], { env: { ...process.env, INPUT_URLS: paths.map(p => origin + p).join('\n'), 'INPUT_FAIL-ON-MISSING': fail, INPUT_TIMEOUT: '2000', GITHUB_OUTPUT: output } });
    let logs = ''; child.stdout.on('data', b => logs += b); child.stderr.on('data', b => logs += b);
    const code = await new Promise(resolve => child.on('close', resolve));
    const values = Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
    return { code, values, logs, results: JSON.parse(values.results) };
  }
  const all = await run(Object.keys(routes));
  assert.equal(all.code, 0, all.logs); assert.equal(all.values['found-count'], '3'); assert.equal(all.values['total-count'], '10');
  assert.deepEqual(all.results.map(r => r.supported), [true, true, true, false, false, false, false, false, false, false]);
  assert.deepEqual(all.results[0].payment, v2);
  for (const i of [3, 5, 6, 7, 8]) assert.equal(typeof all.results[i].error, 'string');
  const missing = await run(['/plain', '/object']); assert.equal(missing.code, 1); assert.equal(missing.values['found-count'], '0');
  const allowed = await run(['/plain'], 'false'); assert.equal(allowed.code, 0);
});
