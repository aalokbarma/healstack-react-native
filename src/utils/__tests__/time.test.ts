import { nowIso, nowMs, resetClock, setClock, toIso } from '../time';

describe('time', () => {
  afterEach(() => {
    resetClock();
  });

  it('uses an injectable clock', () => {
    setClock(() => 1_700_000_000_000);
    expect(nowMs()).toBe(1_700_000_000_000);
    expect(nowIso()).toBe('2023-11-14T22:13:20.000Z');
    expect(toIso(0)).toBe('1970-01-01T00:00:00.000Z');
  });
});
