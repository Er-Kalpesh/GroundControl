import { describe, it, expect, afterEach } from 'vitest';
import { paths, getHome } from '../../src/paths.js';

describe('paths', () => {
  afterEach(() => { delete process.env.GROUNDCONTROL_HOME; });
  it('honours GROUNDCONTROL_HOME', () => {
    process.env.GROUNDCONTROL_HOME = '/tmp/gc-x';
    expect(getHome()).toBe('/tmp/gc-x');
    expect(paths().state).toBe('/tmp/gc-x/state.json');
    expect(paths().logsDir).toBe('/tmp/gc-x/logs');
  });
  it('defaults to ~/.groundcontrol', () => {
    expect(getHome().endsWith('/.groundcontrol')).toBe(true);
  });
});
