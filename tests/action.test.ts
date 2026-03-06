/**
 * Tests for GitHub Action input parsing logic.
 *
 * These tests exercise the URL parsing, timeout validation,
 * and result aggregation logic from action/index.js — extracted
 * into helpers here so they can be tested without a real GitHub runner.
 */
import { describe, it, expect } from 'vitest';

// ── Inline the action's pure logic functions for testing ─────────────────────
// (Mirrors the implementation in action/index.js)

/**
 * Parse the `urls` action input: split on newline, trim, filter valid URLs.
 */
function parseUrls(input: string): string[] {
  return input
    .split('\n')
    .map((u) => u.trim())
    .filter((u) => u && (u.startsWith('http://') || u.startsWith('https://')));
}

/**
 * Count results where supported === true.
 */
function countFound(results: Array<{ supported: boolean }>): number {
  return results.filter((r) => r.supported).length;
}

/**
 * Determine if the action should fail given failOnMissing + foundCount.
 */
function shouldFail(failOnMissing: boolean, foundCount: number): boolean {
  return failOnMissing && foundCount === 0;
}

/**
 * Parse the fail-on-missing input string.
 */
function parseFailOnMissing(value: string): boolean {
  return value.toLowerCase() !== 'false';
}

/**
 * Parse the timeout input string.
 */
function parseTimeout(value: string): number | null {
  const n = parseInt(value || '10000', 10);
  return isNaN(n) || n <= 0 ? null : n;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parseUrls (action input)', () => {
  it('parses a single URL', () => {
    expect(parseUrls('https://api.example.com/resource')).toEqual([
      'https://api.example.com/resource',
    ]);
  });

  it('parses multiple newline-separated URLs', () => {
    const input = 'https://api.example.com/resource\nhttps://api.example.com/premium';
    expect(parseUrls(input)).toEqual([
      'https://api.example.com/resource',
      'https://api.example.com/premium',
    ]);
  });

  it('trims whitespace from each URL', () => {
    const input = '  https://api.example.com/resource  \n  https://api.example.com/premium  ';
    expect(parseUrls(input)).toEqual([
      'https://api.example.com/resource',
      'https://api.example.com/premium',
    ]);
  });

  it('skips empty lines', () => {
    const input = 'https://api.example.com/resource\n\n\nhttps://api.example.com/premium';
    const urls = parseUrls(input);
    expect(urls).toHaveLength(2);
  });

  it('skips non-URL lines', () => {
    const input = 'api.example.com/resource\nftp://example.com\nhttps://api.example.com/ok';
    const urls = parseUrls(input);
    expect(urls).toEqual(['https://api.example.com/ok']);
  });

  it('accepts http:// URLs', () => {
    const urls = parseUrls('http://api.example.com/resource');
    expect(urls).toEqual(['http://api.example.com/resource']);
  });

  it('returns empty array for blank input', () => {
    expect(parseUrls('')).toEqual([]);
    expect(parseUrls('\n\n\n')).toEqual([]);
  });

  it('handles YAML-style multiline input (as GitHub Actions provides)', () => {
    // GitHub Actions passes multiline input with \n separators
    const input = [
      'https://api.example.com/resource',
      'https://api.example.com/premium',
      'https://api.example.com/data',
    ].join('\n');
    expect(parseUrls(input)).toHaveLength(3);
  });
});

describe('countFound', () => {
  it('counts results where supported is true', () => {
    const results = [
      { supported: true },
      { supported: false },
      { supported: true },
      { supported: false },
    ];
    expect(countFound(results)).toBe(2);
  });

  it('returns 0 when none supported', () => {
    const results = [{ supported: false }, { supported: false }];
    expect(countFound(results)).toBe(0);
  });

  it('returns total when all supported', () => {
    const results = [{ supported: true }, { supported: true }, { supported: true }];
    expect(countFound(results)).toBe(3);
  });

  it('handles empty array', () => {
    expect(countFound([])).toBe(0);
  });
});

describe('shouldFail', () => {
  it('fails when failOnMissing=true and foundCount=0', () => {
    expect(shouldFail(true, 0)).toBe(true);
  });

  it('does not fail when failOnMissing=true but foundCount>0', () => {
    expect(shouldFail(true, 1)).toBe(false);
    expect(shouldFail(true, 3)).toBe(false);
  });

  it('does not fail when failOnMissing=false even if foundCount=0', () => {
    expect(shouldFail(false, 0)).toBe(false);
  });
});

describe('parseFailOnMissing', () => {
  it('defaults to true for empty string', () => {
    expect(parseFailOnMissing('')).toBe(true);
  });

  it('returns true for "true"', () => {
    expect(parseFailOnMissing('true')).toBe(true);
  });

  it('returns false for "false"', () => {
    expect(parseFailOnMissing('false')).toBe(false);
  });

  it('is case-insensitive for "false"', () => {
    expect(parseFailOnMissing('False')).toBe(false);
    expect(parseFailOnMissing('FALSE')).toBe(false);
  });

  it('defaults to true for any non-false string', () => {
    expect(parseFailOnMissing('yes')).toBe(true);
    expect(parseFailOnMissing('1')).toBe(true);
  });
});

describe('parseTimeout', () => {
  it('parses valid timeout string', () => {
    expect(parseTimeout('10000')).toBe(10000);
    expect(parseTimeout('5000')).toBe(5000);
  });

  it('returns default (10000) for empty string', () => {
    expect(parseTimeout('')).toBe(10000);
  });

  it('returns null for non-numeric string', () => {
    expect(parseTimeout('abc')).toBeNull();
  });

  it('returns null for zero', () => {
    expect(parseTimeout('0')).toBeNull();
  });

  it('returns null for negative values', () => {
    expect(parseTimeout('-100')).toBeNull();
  });
});
