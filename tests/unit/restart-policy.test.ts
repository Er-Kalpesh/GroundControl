import { it, expect } from 'vitest';
import { nextRestart as n } from '../../src/core/restart-policy.js';

it('never restarts an expected stop', () => expect(n('always', 0, 3, 1000, true, 0).restart).toBe(false));
it('policy never', () => expect(n('never', 0, 3, 1000, false, 1).restart).toBe(false));
it('on-failure ignores a clean exit', () => expect(n('on-failure', 0, 3, 1000, false, 0).restart).toBe(false));
it('on-failure restarts on crash with exponential delay', () => {
  expect(n('on-failure', 0, 3, 1000, false, 1)).toEqual({ restart: true, delayMs: 1000 });
  expect(n('on-failure', 2, 3, 1000, false, 1)).toEqual({ restart: true, delayMs: 4000 });
});
it('on-failure treats unknown exit code (null) as failure', () => expect(n('on-failure', 0, 3, 1000, false, null).restart).toBe(true));
it('always restarts even a clean exit', () => expect(n('always', 0, 3, 1000, false, 0).restart).toBe(true));
it('stops after maxRetries', () => expect(n('always', 3, 3, 1000, false, 1).restart).toBe(false));
it('caps the delay at 30 s', () => expect(n('always', 10, 99, 1000, false, 1).delayMs).toBe(30_000));
