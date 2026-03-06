/**
 * Badge generation for x402-check.
 * Generates shields.io-compatible SVG badges with no external dependencies.
 */

export type BadgeStatus = 'found' | 'not-found' | 'error';

interface BadgeConfig {
  leftLabel: string;
  rightLabel: string;
  rightColor: string;
  leftColor: string;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Approximate character widths for DejaVu Sans 11px font.
 * Matches the table used by shields.io for consistent rendering.
 */
function charWidth(ch: string): number {
  const widths: Record<string, number> = {
    ' ': 3, '!': 4, '"': 5, '#': 9, '$': 7, '%': 9, '&': 8, "'": 3,
    '(': 4, ')': 4, '*': 6, '+': 9, ',': 4, '-': 5, '.': 4, '/': 5,
    '0': 7, '1': 7, '2': 7, '3': 7, '4': 7, '5': 7, '6': 7, '7': 7,
    '8': 7, '9': 7, ':': 4, ';': 4, '<': 9, '=': 9, '>': 9, '?': 6,
    '@': 12, 'A': 7, 'B': 8, 'C': 8, 'D': 8, 'E': 7, 'F': 6, 'G': 9,
    'H': 8, 'I': 3, 'J': 4, 'K': 7, 'L': 6, 'M': 9, 'N': 8, 'O': 9,
    'P': 7, 'Q': 9, 'R': 8, 'S': 7, 'T': 7, 'U': 8, 'V': 7, 'W': 10,
    'X': 7, 'Y': 7, 'Z': 7, '[': 4, '\\': 5, ']': 4, '^': 9, '_': 6,
    '`': 6, 'a': 7, 'b': 7, 'c': 6, 'd': 7, 'e': 7, 'f': 4, 'g': 7,
    'h': 7, 'i': 3, 'j': 3, 'k': 6, 'l': 3, 'm': 10, 'n': 7, 'o': 7,
    'p': 7, 'q': 7, 'r': 4, 's': 6, 't': 5, 'u': 7, 'v': 6, 'w': 9,
    'x': 6, 'y': 6, 'z': 6, '{': 5, '|': 4, '}': 5, '~': 9,
  };
  return widths[ch] ?? 7;
}

function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += charWidth(ch);
  }
  return w;
}

/**
 * Generate a shields.io-compatible SVG badge for x402 status.
 *
 * @param status - 'found' | 'not-found' | 'error'
 * @returns SVG string
 *
 * @example
 * const svg = generateBadge('found');
 * // Write to file or print to stdout
 * process.stdout.write(svg);
 */
export function generateBadge(status: BadgeStatus): string {
  const configs: Record<BadgeStatus, BadgeConfig> = {
    found: {
      leftLabel: 'x402',
      rightLabel: 'verified \u2713',
      rightColor: '#4c1',
      leftColor: '#555',
    },
    'not-found': {
      leftLabel: 'x402',
      rightLabel: 'not found',
      rightColor: '#e05d44',
      leftColor: '#555',
    },
    error: {
      leftLabel: 'x402',
      rightLabel: 'error',
      rightColor: '#9f9f9f',
      leftColor: '#555',
    },
  };

  const cfg = configs[status];
  const leftText = escapeXml(cfg.leftLabel);
  const rightText = escapeXml(cfg.rightLabel);

  // 5px padding each side
  const leftTextW = textWidth(cfg.leftLabel);
  const rightTextW = textWidth(cfg.rightLabel);
  const leftW = leftTextW + 10;
  const rightW = rightTextW + 10;
  const totalW = leftW + rightW;

  // Center positions for text
  const leftCenter = Math.floor(leftW / 2) + 1;
  const rightCenter = leftW + Math.floor(rightW / 2) + 1;

  // Scale factor: font-size=110 + transform="scale(.1)" = 11px effective
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalW}" height="20" role="img" aria-label="${leftText}: ${rightText}">`,
    `  <title>${leftText}: ${rightText}</title>`,
    `  <linearGradient id="s" x2="0" y2="100%">`,
    `    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>`,
    `    <stop offset="1" stop-opacity=".1"/>`,
    `  </linearGradient>`,
    `  <clipPath id="r">`,
    `    <rect width="${totalW}" height="20" rx="3" fill="#fff"/>`,
    `  </clipPath>`,
    `  <g clip-path="url(#r)">`,
    `    <rect width="${leftW}" height="20" fill="${cfg.leftColor}"/>`,
    `    <rect x="${leftW}" width="${rightW}" height="20" fill="${cfg.rightColor}"/>`,
    `    <rect width="${totalW}" height="20" fill="url(#s)"/>`,
    `  </g>`,
    `  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="110" xml:space="preserve">`,
    `    <text aria-hidden="true" x="${leftCenter * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${leftTextW * 10}" lengthAdjust="spacing">${leftText}</text>`,
    `    <text x="${leftCenter * 10}" y="140" transform="scale(.1)" textLength="${leftTextW * 10}" lengthAdjust="spacing">${leftText}</text>`,
    `    <text aria-hidden="true" x="${rightCenter * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${rightTextW * 10}" lengthAdjust="spacing">${rightText}</text>`,
    `    <text x="${rightCenter * 10}" y="140" transform="scale(.1)" textLength="${rightTextW * 10}" lengthAdjust="spacing">${rightText}</text>`,
    `  </g>`,
    `</svg>`,
  ].join('\n');
}
