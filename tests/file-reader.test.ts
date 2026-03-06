import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readUrlsFromFile } from '../src/file-reader.js';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── helpers ──────────────────────────────────────────────────────────────────

function tmpFile(content: string): string {
  const dir = tmpdir();
  const filePath = join(dir, `x402-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('readUrlsFromFile', () => {
  const files: string[] = [];

  function createFile(content: string): string {
    const path = tmpFile(content);
    files.push(path);
    return path;
  }

  afterEach(() => {
    for (const f of files.splice(0)) {
      try { unlinkSync(f); } catch { /* ignore */ }
    }
  });

  it('reads a simple list of URLs', () => {
    const path = createFile(
      'https://api.example.com/resource\nhttps://api.example.com/premium\n'
    );
    const urls = readUrlsFromFile(path);
    expect(urls).toEqual([
      'https://api.example.com/resource',
      'https://api.example.com/premium',
    ]);
  });

  it('skips empty lines', () => {
    const path = createFile(
      'https://api.example.com/resource\n\n\nhttps://api.example.com/premium\n'
    );
    const urls = readUrlsFromFile(path);
    expect(urls).toHaveLength(2);
    expect(urls).toEqual([
      'https://api.example.com/resource',
      'https://api.example.com/premium',
    ]);
  });

  it('skips comment lines starting with #', () => {
    const path = createFile(
      '# My x402 endpoints\nhttps://api.example.com/resource\n# another comment\nhttps://api.example.com/premium\n'
    );
    const urls = readUrlsFromFile(path);
    expect(urls).toEqual([
      'https://api.example.com/resource',
      'https://api.example.com/premium',
    ]);
  });

  it('trims whitespace from each line', () => {
    const path = createFile(
      '  https://api.example.com/resource  \n  https://api.example.com/premium\n'
    );
    const urls = readUrlsFromFile(path);
    expect(urls).toEqual([
      'https://api.example.com/resource',
      'https://api.example.com/premium',
    ]);
  });

  it('handles inline # that are not at start (not treated as comment)', () => {
    // "#" mid-URL should NOT be stripped — it's an anchor fragment
    const path = createFile('https://api.example.com/resource#section\n');
    const urls = readUrlsFromFile(path);
    expect(urls).toEqual(['https://api.example.com/resource#section']);
  });

  it('returns empty array for file with only comments and blank lines', () => {
    const path = createFile('# comment\n\n# another comment\n\n');
    const urls = readUrlsFromFile(path);
    expect(urls).toEqual([]);
  });

  it('returns empty array for empty file', () => {
    const path = createFile('');
    const urls = readUrlsFromFile(path);
    expect(urls).toEqual([]);
  });

  it('handles http:// as well as https://', () => {
    const path = createFile('http://api.example.com/resource\nhttps://api.example.com/premium\n');
    const urls = readUrlsFromFile(path);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe('http://api.example.com/resource');
  });

  it('handles file without trailing newline', () => {
    const path = createFile('https://api.example.com/resource');
    const urls = readUrlsFromFile(path);
    expect(urls).toEqual(['https://api.example.com/resource']);
  });

  it('handles a realistic urls.txt file', () => {
    const content = [
      '# x402 endpoints to monitor',
      '',
      '# Production',
      'https://api.example.com/resource',
      'https://api.example.com/premium-content',
      '',
      '# Staging',
      'https://staging.example.com/resource',
      '',
    ].join('\n');

    const path = createFile(content);
    const urls = readUrlsFromFile(path);
    expect(urls).toEqual([
      'https://api.example.com/resource',
      'https://api.example.com/premium-content',
      'https://staging.example.com/resource',
    ]);
  });

  it('throws on non-existent file', () => {
    expect(() => readUrlsFromFile('/tmp/definitely-does-not-exist-x402.txt')).toThrow();
  });
});
