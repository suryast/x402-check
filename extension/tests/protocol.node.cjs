const {test}=require('node:test'); const assert=require('node:assert/strict');
require('../protocol.js'); const p=globalThis.X402Protocol;
const v2={x402Version:2,resource:{url:'https://example.test/api?token=private',description:'<img src=x onerror=alert(1)>'},accepts:[{scheme:'exact',network:'eip155:8453',amount:'10000',asset:'USDC',payTo:'merchant',maxTimeoutSeconds:60}]};
const v1={x402Version:1,accepts:[{scheme:'exact',network:'base',maxAmountRequired:'10000',asset:'USDC',payTo:'merchant',maxTimeoutSeconds:60,resource:'https://example.test/api'}]};
test('v2, UTF8, amount units and URL redaction',()=>{const x=p.detect(402,[{name:'PAYMENT-REQUIRED',value:Buffer.from(JSON.stringify(v2)).toString('base64')}],'https://example.test/api?secret=x');assert.equal(x.version,2);assert.equal(x.amount,'10000');assert.equal(x.url,'https://example.test/api');assert.equal(x.resource,'https://example.test/api');});
test('legacy v1 explicit',()=>assert.equal(p.fromPayload(v1,'https://example.test/api').version,1));
test('plain/malformed 402 and non402 rejected',()=>{for(const h of [[],[{name:'payment-required',value:'broken'}]])assert.equal(p.detect(402,h,'https://example.test'),null);assert.equal(p.detect(200,[], 'https://example.test'),null);});
test('required fields/version/network/integer validation',()=>{for(const change of [{x402Version:3},{resource:null},{accepts:[{...v2.accepts[0],network:'base'}]},{accepts:[{...v2.accepts[0],amount:'0.1'}]},{accepts:[{...v2.accepts[0],payTo:''}]}])assert.equal(p.fromPayload({...v2,...change},'https://example.test'),null);});
test('legacy header does not advertise v2',()=>assert.equal(p.detect(402,[{name:'x-payment-required',value:Buffer.from(JSON.stringify(v2)).toString('base64')}],'https://example.test'),null));
