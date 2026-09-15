import { normalizeException } from '../normalizeException';

describe('normalizeException', () => {
  it('normalizes Error instances', () => {
    const err = new TypeError('boom');
    const ex = normalizeException(err);
    expect(ex.type).toBe('TypeError');
    expect(ex.value).toBe('boom');
    expect(ex.mechanism?.handled).toBe(true);
  });

  it('normalizes string throws', () => {
    const ex = normalizeException('plain string error');
    expect(ex.type).toBe('Error');
    expect(ex.value).toBe('plain string error');
    expect(ex.stacktrace).toBeUndefined();
  });

  it('normalizes unknown objects with message', () => {
    const ex = normalizeException({ message: 'from object', name: 'CustomError' });
    expect(ex.type).toBe('CustomError');
    expect(ex.value).toBe('from object');
  });

  it('handles missing message', () => {
    const ex = normalizeException({});
    expect(ex.value).toBe('(no message)');
  });

  it('parses stack from duck-typed error objects', () => {
    const ex = normalizeException({
      message: 'x',
      stack: 'Error: x\n    at foo (app.js:10:5)',
    });
    expect(ex.stacktrace?.frames.length).toBeGreaterThan(0);
  });

  it('handles missing stack gracefully', () => {
    const ex = normalizeException(new Error('no stack'));
    delete (ex as { stacktrace?: unknown }).stacktrace;
    const normalized = normalizeException({ message: 'no stack' });
    expect(normalized.stacktrace).toBeUndefined();
  });
});
