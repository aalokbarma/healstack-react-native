import { normalizeValue } from '../normalizeValue';

describe('normalizeValue', () => {
  it('passes through primitives', () => {
    expect(normalizeValue(null)).toBeNull();
    expect(normalizeValue(undefined)).toBeUndefined();
    expect(normalizeValue(42)).toBe(42);
    expect(normalizeValue(true)).toBe(true);
    expect(normalizeValue('hello')).toBe('hello');
  });

  it('truncates long strings', () => {
    const long = 'a'.repeat(100);
    const out = normalizeValue(long, { maxStringLength: 10 }) as string;
    expect(out).toContain('[truncated]');
    expect(out.startsWith('aaaaaaaaaa')).toBe(true);
    expect(out.length).toBeLessThan(long.length);
  });

  it('normalizes nested objects and arrays', () => {
    const out = normalizeValue({
      tags: ['a', 'b'],
      meta: { nested: { ok: true } },
    }) as Record<string, unknown>;
    expect(out.tags).toEqual(['a', 'b']);
    expect((out.meta as Record<string, unknown>).nested).toEqual({ ok: true });
  });

  it('detects circular references', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(normalizeValue(obj)).toEqual({ a: 1, self: '[Circular]' });
  });

  it('respects max depth', () => {
    const deep = { l1: { l2: { l3: { l4: { l5: { l6: 'deep' } } } } } };
    const out = normalizeValue(deep, { maxDepth: 2 }) as Record<string, unknown>;
    expect(out.l1).toEqual({ l2: '[MaxDepth]' });
  });

  it('serializes Error values in objects', () => {
    const out = normalizeValue({ err: new Error('nested') }) as Record<string, unknown>;
    expect(out.err).toEqual(expect.objectContaining({ name: 'Error', message: 'nested' }));
  });
});
