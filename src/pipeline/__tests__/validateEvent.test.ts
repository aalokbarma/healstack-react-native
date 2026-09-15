import { validateEvent } from '../validateEvent';
import { SDK_NAME, SDK_VERSION } from '../../version';

describe('validateEvent', () => {
  const valid = {
    event_id: '00000000-0000-4000-8000-000000000099',
    type: 'message',
    timestamp: '2026-01-01T00:00:00.000Z',
    level: 'info',
    sdk: { name: SDK_NAME, version: SDK_VERSION },
    message: 'ok',
  };

  it('accepts a well-formed event', () => {
    const result = validateEvent(valid);
    expect(result.ok).toBe(true);
  });

  it('rejects missing required fields', () => {
    expect(validateEvent({ ...valid, event_id: '' }).ok).toBe(false);
    expect(validateEvent({ ...valid, timestamp: '' }).ok).toBe(false);
    expect(validateEvent({ ...valid, type: '' }).ok).toBe(false);
    expect(validateEvent({ ...valid, sdk: { name: SDK_NAME } }).ok).toBe(false);
    expect(validateEvent({ ...valid, level: '' }).ok).toBe(false);
  });
});
