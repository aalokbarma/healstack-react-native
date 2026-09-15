import { prepareUserContext } from '../prepareUserContext';

describe('prepareUserContext', () => {
  it('accepts optional id-only user', () => {
    const user = prepareUserContext({ id: '123' }, { scrubFields: [] });
    expect(user).toEqual({ id: '123' });
  });

  it('accepts id, email, and username', () => {
    const user = prepareUserContext(
      { id: '123', email: 'user@example.com', username: 'alice' },
      { scrubFields: [] },
    );
    expect(user).toEqual({
      id: '123',
      email: 'user@example.com',
      username: 'alice',
    });
  });

  it('replaces user context entirely on subsequent set', () => {
    const first = prepareUserContext({ id: '1', email: 'a@b.com' }, { scrubFields: [] });
    const second = prepareUserContext({ id: '2' }, { scrubFields: [] });
    expect(first?.email).toBe('a@b.com');
    expect(second).toEqual({ id: '2' });
    expect(second?.email).toBeUndefined();
  });

  it('truncates long fields', () => {
    const user = prepareUserContext({ id: 'x'.repeat(200) }, { scrubFields: [] });
    expect(user?.id).toContain('[truncated]');
  });

  it('redacts sensitive extra fields', () => {
    const user = prepareUserContext(
      { id: '1', password: 'secret', token: 'abc', plan: 'pro' },
      { scrubFields: [] },
    );
    expect(user?.password).toBe('[redacted]');
    expect(user?.token).toBe('[redacted]');
    expect(user?.plan).toBe('pro');
  });

  it('respects custom scrubFields', () => {
    const user = prepareUserContext(
      { id: '1', internal_id: 'xyz' },
      { scrubFields: ['internal_id'] },
    );
    expect(user?.internal_id).toBe('[redacted]');
  });

  it('returns undefined for empty or invalid input', () => {
    expect(prepareUserContext({}, { scrubFields: [] })).toBeUndefined();
    expect(
      prepareUserContext(null as unknown as { id: string }, { scrubFields: [] }),
    ).toBeUndefined();
  });
});
