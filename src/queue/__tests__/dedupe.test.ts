import { EventDedupe, fingerprintException } from '../dedupe';

describe('EventDedupe', () => {
  it('suppresses duplicate fingerprints within the window', () => {
    const dedupe = new EventDedupe({ windowMs: 5_000, maxEntries: 10 });
    const fp = fingerprintException({ type: 'Error', value: 'same' });
    expect(dedupe.shouldSuppress(fp)).toBe(false);
    expect(dedupe.shouldSuppress(fp)).toBe(true);
  });

  it('allows the same fingerprint after clear', () => {
    const dedupe = new EventDedupe({ windowMs: 5_000, maxEntries: 10 });
    const fp = fingerprintException({ type: 'Error', value: 'same' });
    dedupe.shouldSuppress(fp);
    dedupe.clear();
    expect(dedupe.shouldSuppress(fp)).toBe(false);
  });
});
