// Install and exercise the sealed tarball in an isolated consumer, without lifecycle scripts.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const directory = mkdtempSync(join(tmpdir(),'release-consumer-'));
const tarball = resolve(process.argv[2] || 'release-artifact/package.tgz');
try {
  writeFileSync(join(directory,'package.json'),JSON.stringify({name:'release-consumer',version:'0.0.0',private:true}));
  execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund','--registry','https://registry.npmjs.org',tarball],{cwd:directory,stdio:'inherit'});
  const modulePath = join(directory,'node_modules/x402-validate/dist/index.js');
  const esm = await import(pathToFileURL(modulePath).href);
  const cjs = createRequire(join(directory,'package.json'))('x402-validate');
  for (const api of [esm,cjs]) {
    assert.equal(typeof api.checkX402,'function');
    assert.equal(typeof api.decodePaymentRequired,'function');
    assert.equal(api.validatePaymentRequired({}).valid,false);
  }
  const output = execFileSync(process.execPath,[join(directory,'node_modules/x402-validate/dist/cli.js'),'--help'],{encoding:'utf8'});
  assert.match(output,/x402-validate/);
  console.log('Packed consumer module and CLI checks passed');
} finally { rmSync(directory,{recursive:true,force:true}); }
