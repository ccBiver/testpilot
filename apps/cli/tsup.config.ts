import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  // workspace 包内联进产物,发布后无需 monorepo;重依赖保持外部(走 npm dependencies)
  noExternal: [/^@testpilot\//],
  external: [
    'playwright',
    '@midscene/web',
    '@midscene/android',
    '@playwright/test',
    '@modelcontextprotocol/sdk',
    '@clack/prompts',
    'commander',
    'yaml',
    'zod',
  ],
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  minify: false,
  sourcemap: false,
});
