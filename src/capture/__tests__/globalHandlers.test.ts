import { GlobalErrorHandlerManager } from '../globalHandlers';
import { getErrorUtils } from '../../platform/globals';

describe('GlobalErrorHandlerManager', () => {
  const previousCalls: Array<{ error: Error; isFatal?: boolean }> = [];
  let mockErrorUtils: {
    handler: ((error: Error, isFatal?: boolean) => void) | undefined;
    getGlobalHandler: () => ((error: Error, isFatal?: boolean) => void) | undefined;
    setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void;
  };

  beforeEach(() => {
    previousCalls.length = 0;
    mockErrorUtils = {
      handler: undefined,
      getGlobalHandler: () => mockErrorUtils.handler,
      setGlobalHandler: (handler) => {
        mockErrorUtils.handler = handler;
      },
    };
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = mockErrorUtils;
  });

  afterEach(() => {
    delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
  });

  it('chains onto the previous handler', () => {
    const previous = jest.fn((error: Error) => {
      previousCalls.push({ error });
    });
    mockErrorUtils.handler = previous;

    const captured: Error[] = [];
    const manager = new GlobalErrorHandlerManager();
    manager.install((error) => {
      captured.push(error);
    });

    const err = new Error('chain test');
    mockErrorUtils.handler?.(err, true);

    expect(captured).toHaveLength(1);
    expect(captured[0]).toBe(err);
    expect(previous).toHaveBeenCalledWith(err, true);
  });

  it('restores the previous handler on uninstall', () => {
    const previous = jest.fn();
    mockErrorUtils.handler = previous;

    const manager = new GlobalErrorHandlerManager();
    manager.install(() => undefined);
    expect(mockErrorUtils.handler).not.toBe(previous);

    manager.uninstall();
    expect(mockErrorUtils.handler).toBe(previous);
  });

  it('does not throw when previous handler throws', () => {
    mockErrorUtils.handler = () => {
      throw new Error('previous blew up');
    };

    const manager = new GlobalErrorHandlerManager();
    manager.install(() => undefined);

    expect(() => mockErrorUtils.handler?.(new Error('x'))).not.toThrow();
  });

  it('reports unavailable ErrorUtils safely', () => {
    delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
    const manager = new GlobalErrorHandlerManager();
    const result = manager.install(() => undefined);
    expect(result.installed).toBe(false);
    expect(getErrorUtils()).toBeUndefined();
  });

  it('uninstalls cleanly when there was no previous handler', () => {
    mockErrorUtils.handler = undefined;

    const manager = new GlobalErrorHandlerManager();
    manager.install(() => undefined);
    const installed = mockErrorUtils.handler;
    expect(installed).toBeDefined();

    manager.uninstall();
    expect(mockErrorUtils.handler).not.toBe(installed);
  });
});
