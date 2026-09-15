import { computeBackoffMs, sleepMs } from '../backoff';

describe('computeBackoffMs', () => {
  it('uses exponential growth without jitter', () => {
    expect(computeBackoffMs(0, { baseMs: 1000, jitter: 'none' })).toBe(1000);
    expect(computeBackoffMs(1, { baseMs: 1000, jitter: 'none' })).toBe(2000);
    expect(computeBackoffMs(2, { baseMs: 1000, jitter: 'none' })).toBe(4000);
  });

  it('caps at maxMs', () => {
    expect(computeBackoffMs(20, { baseMs: 1000, maxMs: 5000, jitter: 'none' })).toBe(5000);
  });

  it('applies full jitter with injectable random', () => {
    expect(computeBackoffMs(0, { baseMs: 1000, jitter: 'full', random: () => 0 })).toBe(0);
    expect(computeBackoffMs(0, { baseMs: 1000, jitter: 'full', random: () => 1 })).toBe(1000);
    expect(computeBackoffMs(1, { baseMs: 1000, jitter: 'full', random: () => 0.5 })).toBe(1000);
  });
});

describe('sleepMs', () => {
  it('resolves immediately for non-positive delay', async () => {
    await expect(sleepMs(0)).resolves.toBeUndefined();
    await expect(sleepMs(-1)).resolves.toBeUndefined();
  });

  it('resolves early when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleepMs(10_000, controller.signal)).resolves.toBeUndefined();
  });
});
