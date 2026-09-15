import { Scope } from '../Scope';

describe('Scope metadata', () => {
  it('set and clear user', () => {
    const scope = new Scope(10, 10);
    scope.setUser({ id: '1' });
    expect(scope.snapshot().user?.id).toBe('1');
    scope.clearUser();
    expect(scope.snapshot().user).toBeUndefined();
  });

  it('set, replace, and clear tags', () => {
    const scope = new Scope(10, 10);
    scope.setTag('feature', 'payments');
    scope.setTag('env', 'prod');
    expect(scope.snapshot().tags).toEqual({ feature: 'payments', env: 'prod' });

    scope.setTag('feature', 'checkout');
    expect(scope.snapshot().tags.feature).toBe('checkout');

    scope.clearTag('env');
    expect(scope.snapshot().tags).toEqual({ feature: 'checkout' });

    scope.clearTags();
    expect(scope.snapshot().tags).toEqual({});
  });

  it('enforces max tag count', () => {
    const scope = new Scope(10, 2);
    scope.setTag('a', '1');
    scope.setTag('b', '2');
    scope.setTag('c', '3');
    expect(Object.keys(scope.snapshot().tags)).toEqual(['a', 'b']);

    scope.setTag('a', 'updated');
    expect(scope.snapshot().tags).toEqual({ a: 'updated', b: '2' });
  });

  it('set and clear extras and contexts', () => {
    const scope = new Scope(10, 10);
    scope.setExtra('debug', { nested: true });
    scope.setContext('cart', { items: 2 });
    expect(scope.snapshot().extra.debug).toEqual({ nested: true });
    expect(scope.snapshot().contexts.cart).toEqual({ items: 2 });

    scope.clearExtra('debug');
    scope.clearContext('cart');
    expect(scope.snapshot().extra.debug).toBeUndefined();
    expect(scope.snapshot().contexts.cart).toBeUndefined();
  });

  it('enforces max extra and context key counts', () => {
    const scope = new Scope(10, 10, { maxExtraKeys: 2, maxContextKeys: 1 });
    scope.setExtra('a', 1);
    scope.setExtra('b', 2);
    scope.setExtra('c', 3);
    expect(Object.keys(scope.snapshot().extra).sort()).toEqual(['a', 'b']);
    scope.setExtra('a', 9);
    expect(scope.snapshot().extra.a).toBe(9);

    scope.setContext('one', { x: 1 });
    scope.setContext('two', { y: 2 });
    expect(Object.keys(scope.snapshot().contexts)).toEqual(['one']);
  });
});
