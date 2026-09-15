import { BreadcrumbBuffer } from '../breadcrumbs';

describe('BreadcrumbBuffer', () => {
  it('stores breadcrumbs in FIFO order', () => {
    const buffer = new BreadcrumbBuffer(3);
    buffer.add({ timestamp: '2026-01-01T00:00:00.000Z', message: 'first' });
    buffer.add({ timestamp: '2026-01-01T00:00:01.000Z', message: 'second' });
    buffer.add({ timestamp: '2026-01-01T00:00:02.000Z', message: 'third' });

    expect(buffer.getAll().map((c) => c.message)).toEqual(['first', 'second', 'third']);
  });

  it('evicts the oldest breadcrumb when max count is reached', () => {
    const buffer = new BreadcrumbBuffer(2);
    buffer.add({ timestamp: '1', message: 'a' });
    buffer.add({ timestamp: '2', message: 'b' });
    buffer.add({ timestamp: '3', message: 'c' });

    expect(buffer.getAll().map((c) => c.message)).toEqual(['b', 'c']);
  });

  it('respects max size of zero', () => {
    const buffer = new BreadcrumbBuffer(0);
    buffer.add({ timestamp: '1', message: 'ignored' });
    expect(buffer.getAll()).toEqual([]);
  });

  it('trims when max size is lowered', () => {
    const buffer = new BreadcrumbBuffer(5);
    for (let i = 0; i < 5; i += 1) {
      buffer.add({ timestamp: String(i), message: `m${i}` });
    }
    buffer.setMaxSize(2);
    expect(buffer.getAll().map((c) => c.message)).toEqual(['m3', 'm4']);
  });

  it('clears all breadcrumbs', () => {
    const buffer = new BreadcrumbBuffer(5);
    buffer.add({ timestamp: '1', message: 'x' });
    buffer.clear();
    expect(buffer.getAll()).toEqual([]);
  });
});
