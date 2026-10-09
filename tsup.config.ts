import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'cli/index': 'src/cli/index.ts', 'daemon/main': 'src/daemon/main.ts', 'mcp/server': 'src/mcp/server.ts' },
  format: ['esm'], target: 'node20', outDir: 'dist', clean: false, splitting: false, sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
});
