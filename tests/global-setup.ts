import { execSync } from 'node:child_process';

/** Build once before any test: the e2e tests run the real bundled CLI, daemon and MCP server from dist/. */
export default function setup() {
  execSync('npx tsup', { stdio: 'inherit' });
}
