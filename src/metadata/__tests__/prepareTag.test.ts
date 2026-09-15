import { prepareTag } from '../prepareTag';

describe('prepareTag', () => {
  it('normalizes string key and value', () => {
    expect(prepareTag('feature', 'payments')).toEqual({
      key: 'feature',
      value: 'payments',
    });
  });

  it('coerces boolean and number values to strings', () => {
    expect(prepareTag('enabled', true)?.value).toBe('true');
    expect(prepareTag('count', 42)?.value).toBe('42');
  });

  it('rejects invalid keys and values', () => {
    expect(prepareTag('', 'x')).toBeUndefined();
    expect(prepareTag('  ', 'x')).toBeUndefined();
    expect(prepareTag('key', '')).toBeUndefined();
    expect(prepareTag('key', '   ')).toBeUndefined();
    expect(prepareTag('key', { bad: true })).toBeUndefined();
  });

  it('truncates long keys and values', () => {
    const tag = prepareTag('k'.repeat(100), 'v'.repeat(100), {
      maxTagKeyLength: 10,
      maxTagValueLength: 10,
    });
    expect(tag?.key).toContain('[truncated]');
    expect(tag?.value).toContain('[truncated]');
  });
});
