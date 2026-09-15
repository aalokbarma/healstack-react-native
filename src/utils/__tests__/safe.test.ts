import { resetLogger, setInternalErrorHandler } from '../logger';
import { safe, safeAsync, safeAsyncWithTimeout, safeRun } from '../safe';

describe('safe', () => {
  beforeEach(() => {
    resetLogger();
  });

  afterEach(() => {
    resetLogger();
  });

  it('returns the function result on success', () => {
    expect(safe(() => 42, 0, 'ok')).toBe(42);
  });

  it('returns fallback and never throws when fn throws', () => {
    const handler = jest.fn();
    setInternalErrorHandler(handler);
    expect(
      safe(
        () => {
          throw new Error('boom');
        },
        7,
        'tag',
      ),
    ).toBe(7);
    expect(handler).toHaveBeenCalled();
  });

  it('safeRun swallows throws', () => {
    expect(() =>
      safeRun(() => {
        throw new Error('boom');
      }, 'tag'),
    ).not.toThrow();
  });

  it('safeAsync returns the resolved value', async () => {
    await expect(safeAsync(async () => 'ok', 'fallback', 'tag')).resolves.toBe('ok');
  });

  it('safeAsync returns fallback on rejection', async () => {
    const result = await safeAsync(
      async () => {
        throw new Error('async boom');
      },
      'fallback',
      'async-tag',
    );
    expect(result).toBe('fallback');
  });

  it('safeAsyncWithTimeout returns value when fn resolves in time', async () => {
    await expect(safeAsyncWithTimeout(async () => 'fast', 'timed-out', 'tag', 1000)).resolves.toBe(
      'fast',
    );
  });

  it('safeAsyncWithTimeout returns fallback on timeout', async () => {
    jest.useFakeTimers();
    const promise = safeAsyncWithTimeout(
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve('late'), 10_000);
        }),
      'timed-out',
      'timeout-tag',
      50,
    );
    await jest.advanceTimersByTimeAsync(50);
    await expect(promise).resolves.toBe('timed-out');
    jest.useRealTimers();
  });

  it('safeAsyncWithTimeout returns fallback when fn rejects', async () => {
    await expect(
      safeAsyncWithTimeout(
        async () => {
          throw new Error('reject');
        },
        'fallback',
        'reject-tag',
        1000,
      ),
    ).resolves.toBe('fallback');
  });

  it('safeAsyncWithTimeout does not leave unhandled rejections after timeout', async () => {
    jest.useFakeTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    let rejectWork!: (error: Error) => void;
    const promise = safeAsyncWithTimeout(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectWork = reject;
        }),
      'timed-out',
      'late-reject',
      50,
    );

    await jest.advanceTimersByTimeAsync(50);
    await expect(promise).resolves.toBe('timed-out');

    rejectWork(new Error('late boom'));
    await Promise.resolve();
    await Promise.resolve();
    expect(unhandled).toHaveLength(0);

    process.off('unhandledRejection', onUnhandled);
    jest.useRealTimers();
  });
});
