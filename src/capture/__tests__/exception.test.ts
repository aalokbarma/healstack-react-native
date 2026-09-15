import { prepareExceptionCapture, prepareUnhandledExceptionCapture } from '../exception';

describe('prepareExceptionCapture', () => {
  it('marks manual captures as handled generic', () => {
    const prepared = prepareExceptionCapture(new Error('manual'));
    expect(prepared.exception.mechanism?.type).toBe('generic');
    expect(prepared.exception.mechanism?.handled).toBe(true);
    expect(prepared.level).toBe('error');
  });

  it('accepts string throws', () => {
    const prepared = prepareExceptionCapture('string throw');
    expect(prepared.exception.value).toBe('string throw');
  });

  it('accepts unknown objects', () => {
    const prepared = prepareExceptionCapture({ message: 'from object', code: 500 });
    expect(prepared.exception.value).toBe('from object');
  });
});

describe('prepareUnhandledExceptionCapture', () => {
  it('marks uncaught errors as unhandled onerror', () => {
    const prepared = prepareUnhandledExceptionCapture(new Error('uncaught'), {
      source: 'onerror',
      isFatal: true,
    });
    expect(prepared.exception.mechanism?.type).toBe('onerror');
    expect(prepared.exception.mechanism?.handled).toBe(false);
    expect(prepared.exception.mechanism?.data).toEqual({ is_fatal: true });
    expect(prepared.level).toBe('fatal');
  });

  it('marks promise rejections as onunhandledrejection', () => {
    const prepared = prepareUnhandledExceptionCapture('rejected', {
      source: 'onunhandledrejection',
    });
    expect(prepared.exception.mechanism?.type).toBe('onunhandledrejection');
    expect(prepared.exception.value).toBe('rejected');
  });
});
