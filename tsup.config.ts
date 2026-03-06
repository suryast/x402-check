import { defineConfig } from 'tsup';

export default defineConfig([
  // Library — dual CJS + ESM
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    target: 'node18',
  },
  // CLI — ESM only, executable shebang preserved
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: false,
    clean: false,
    splitting: false,
    sourcemap: false,
    target: 'node18',
    banner: {
      js: '#!/usr/bin/env node',
    },
    external: [],
    noExternal: [],
  },
]);
