import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { table, fmtUptime, statusTable } from '../../src/cli/format.js';
import { detectConfig } from '../../src/cli/init.js';
import { plist, LABEL } from '../../src/cli/launchd.js';
import { parseConfig } from '../../src/config/load.js';

describe('format', () => {
  it('pads columns', () => {
    expect(table(['A', 'BB'], [['x', 'y'], ['long', 'z']])).toBe('A     BB\n----  --\nx     y\nlong  z');
  });
  it('formats uptimes', () => {
    expect([5000, 65000, 3_700_000, 90_000_000].map(fmtUptime)).toEqual(['5s', '1m5s', '1h1m', '1d1h']);
  });
  it('renders statuses and the empty case', () => {
    expect(statusTable([])).toBe('no services');
    const t = statusTable([{ id: 'p/a', project: 'p', name: 'a', state: 'ready', pid: 7, port: 80, startedAt: 1000, restarts: 1, cpuPercent: 1.5, memoryMb: 30 }], 62_000);
    expect(t).toContain('p/a'); expect(t).toContain('1m1s'); expect(t).toContain('30');
  });
});
describe('detectConfig', () => {
  const mk = (files: Record<string, string>) => { const d = mkdtempSync(join(tmpdir(), 'my app-')); for (const [f, c] of Object.entries(files)) writeFileSync(join(d, f), c); return d; };
  it('detects Laravel + Vite + docker and produces a valid config', () => {
    const d = mk({ artisan: '', 'compose.yaml': '', 'package.json': JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' }, devDependencies: { vite: '^5' } }) });
    const raw = detectConfig(d);
    const cfg = parseConfig(raw, join(d, 'groundcontrol.json'));
    expect(Object.keys(cfg.services).sort()).toEqual(['api', 'docker', 'web']);
    expect(cfg.services.api!.dependsOn).toEqual(['docker']); expect(cfg.services.web!.dependsOn).toEqual(['api']);
    expect(cfg.services.web!.port).toBe(5173); expect(Object.keys(cfg.tasks).sort()).toEqual(['build', 'migrate', 'test']);
    expect(cfg.project).toMatch(/^my-app-/);
  });
  it('returns a valid empty config for an unknown project', () => {
    const d = mk({}); const cfg = parseConfig(detectConfig(d), join(d, 'groundcontrol.json'));
    expect(cfg.services).toEqual({});
  });
  it('tolerates a broken package.json', () => {
    const d = mk({ 'package.json': '{ nope' }); expect(() => parseConfig(detectConfig(d), join(d, 'g.json'))).not.toThrow();
  });
});
describe('launchd plist', () => {
  const x = plist({ node: '/usr/local/bin/node', daemon: '/x/dist/daemon/main.js', path: '/opt/homebrew/bin:/usr/bin', home: '/h/.gc', port: 9876, logFile: '/h/.gc/daemon.log' });
  it('has the label, program, boot flag and crash-only keepalive', () => {
    expect(x).toContain(`<string>${LABEL}</string>`); expect(x).toContain('<string>/x/dist/daemon/main.js</string>');
    expect(x).toContain('<key>GROUNDCONTROL_BOOT</key>'); expect(x).toContain('<key>SuccessfulExit</key>');
    expect(x).toContain('/opt/homebrew/bin:/usr/bin'); expect(x).toContain('GROUNDCONTROL_HOME');
  });
  it('escapes XML', () => { expect(plist({ node: 'n', daemon: 'd', path: 'a&b<c', logFile: 'l' })).toContain('a&amp;b&lt;c'); });
});
