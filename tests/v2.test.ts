import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { checkX402, validateSchema } from '../src/index.js';

// Official v2 specification section 5.1 example (unsigned payment challenge).
export const v2 = {
  x402Version: 2,
  resource: { url: 'https://api.example.com/premium-data', description: 'Premium data', mimeType: 'application/json' },
  accepts: [{ scheme: 'exact', network: 'eip155:84532', amount: '10000',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    payTo: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C', maxTimeoutSeconds: 60,
    extra: { name: 'USDC', version: '2' } }], extensions: {},
};
describe('v2 challenge validation', () => {
  it('accepts the official v2 layout without legacy fields or facilitatorUrl', () => {
    expect(validateSchema(v2)).toEqual({ valid: true, errors: [], warnings: [] });
  });
  it.each([0, -1, 1.5, 3, NaN])('rejects unsupported protocol version %s', version => {
    expect(validateSchema({ ...v2, x402Version: version }).valid).toBe(false);
  });
  it.each(['', '-1', '1.2', '1e6', ' 100', 0, null])('rejects malformed amount %s', amount => {
    expect(validateSchema({ ...v2, accepts: [{ ...v2.accepts[0], amount }] }).valid).toBe(false);
  });
  it.each(['base', 'eip155:', 'eip155:8453:extra', ':8453'])('rejects malformed CAIP-2 %s', network => {
    expect(validateSchema({ ...v2, accepts: [{ ...v2.accepts[0], network }] }).valid).toBe(false);
  });
  it.each([null, [], 'https://example.com', { url: 42 }])('rejects malformed resource %s', resource => {
    expect(validateSchema({ ...v2, resource }).valid).toBe(false);
  });
  it('accepts a Solana CAIP-2 network without a chain allowlist', () => {
    expect(validateSchema({ ...v2, accepts: [{ ...v2.accepts[0], network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' }] }).valid).toBe(true);
  });
  it.each([-1, 0, 1.5, '60', null])('rejects malformed timeout %s', maxTimeoutSeconds => {
    expect(validateSchema({ ...v2, accepts: [{ ...v2.accepts[0], maxTimeoutSeconds }] }).valid).toBe(false);
  });
  it('rejects array envelopes', () => expect(validateSchema([]).valid).toBe(false));
  it('detects the v2 header over real loopback HTTP', async () => {
    const server = createServer((_, res) => {
      res.writeHead(402, { 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(v2)).toString('base64') }); res.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw Error('Missing port');
      const result = await checkX402(`http://127.0.0.1:${address.port}/`, { checkFacilitator: false });
      expect(result.supported).toBe(true);
      expect(result.schemaValidation?.valid).toBe(true);
      expect(result.paymentDetails).toEqual(v2);
    } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
  });
});
