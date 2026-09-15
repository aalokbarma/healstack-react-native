/**
 * In-memory transport for tests and offline stubbing.
 * Records batches and always accepts them.
 */

import type { HealStackEvent } from '../types/events';
import type { Transport, TransportRequest, TransportResult } from './Transport';

export class MemoryTransport implements Transport {
  readonly sent: HealStackEvent[][] = [];

  async send(request: TransportRequest): Promise<TransportResult> {
    this.sent.push(request.events.slice());
    return { status: 'accepted', httpStatus: 202 };
  }

  get allEvents(): HealStackEvent[] {
    const out: HealStackEvent[] = [];
    for (const batch of this.sent) {
      for (const event of batch) {
        out.push(event);
      }
    }
    return out;
  }

  clear(): void {
    this.sent.length = 0;
  }
}
