import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Read URLs from a text file — one URL per line.
 * Skips empty lines and comment lines (starting with #).
 *
 * @param filePath - Absolute or relative path to the URLs file
 * @returns Array of URL strings
 *
 * @example
 * // urls.txt:
 * // # My x402 endpoints
 * // https://api.example.com/resource
 * // https://api.example.com/premium
 *
 * const urls = readUrlsFromFile('urls.txt');
 * // ['https://api.example.com/resource', 'https://api.example.com/premium']
 */
export function readUrlsFromFile(filePath: string): string[] {
  const absPath = resolve(filePath);
  const content = readFileSync(absPath, 'utf-8');

  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .filter((line) => {
      // #15: Skip lines that are not valid http:// or https:// URLs
      if (!line.startsWith('http://') && !line.startsWith('https://')) {
        process.stderr.write(
          `[x402-check] Warning: Skipping invalid URL (must start with http:// or https://): ${line}\n`
        );
        return false;
      }
      return true;
    });
}
