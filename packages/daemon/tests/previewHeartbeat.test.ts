import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PreviewSupervisor } from '../src/previewSupervisor.js';

describe('PreviewSupervisor heartbeat tracking', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('emits preview-stale when no heartbeat received within 15s', () => {
    const sup = new PreviewSupervisor();
    const events: string[] = [];
    sup.on('preview-stale', (id: string) => events.push(id));
    sup.recordHeartbeat('s1');
    vi.advanceTimersByTime(20_000);
    expect(events).toContain('s1');
  });
});
