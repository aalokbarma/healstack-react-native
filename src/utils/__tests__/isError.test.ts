import { errorMessage, errorName, isError } from '../isError';

describe('isError', () => {
  it('recognizes Error instances and duck-typed errors', () => {
    expect(isError(new Error('x'))).toBe(true);
    expect(isError({ message: 'x', name: 'TypeError' })).toBe(true);
    expect(isError({ message: 'x', stack: 'at foo' })).toBe(true);
    expect(isError({ message: 1 })).toBe(false);
    expect(isError('x')).toBe(false);
    expect(isError(null)).toBe(false);
  });

  it('extracts messages and names safely', () => {
    expect(errorMessage(new TypeError('boom'))).toBe('boom');
    expect(errorName(new TypeError('boom'))).toBe('TypeError');
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage({ a: 1 })).toBe('{"a":1}');
    expect(errorName({ message: 'x' })).toBe('object');

    class Custom {}
    expect(errorName(new Custom())).toBe('Custom');

    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(errorMessage(circular)).toBe('[object Object]');
  });
});
