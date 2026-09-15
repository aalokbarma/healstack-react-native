import { EventQueue } from '../EventQueue';
import { SDK_NAME, SDK_VERSION } from '../../version';
import type { HealStackEvent } from '../../types/events';

function event(id: string, level: HealStackEvent['level'] = 'error'): HealStackEvent {
  return {
    event_id: id,
    type: 'message',
    timestamp: '2026-01-01T00:00:00.000Z',
    level,
    message: id,
    sdk: { name: SDK_NAME, version: SDK_VERSION },
  };
}

describe('EventQueue', () => {
  it('supports peek, dequeue, remove', () => {
    const queue = new EventQueue(10, 1024 * 1024);
    queue.enqueue(event('a'));
    queue.enqueue(event('b'));
    expect(queue.peek()?.event_id).toBe('a');
    expect(queue.dequeue(1)[0]?.event_id).toBe('a');
    expect(queue.remove('b')).toBe(true);
    expect(queue.size).toBe(0);
  });
});
