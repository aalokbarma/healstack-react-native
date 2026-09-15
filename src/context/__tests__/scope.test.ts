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
});
