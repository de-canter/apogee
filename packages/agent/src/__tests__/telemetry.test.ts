import { describe, expect, it, vi } from 'vitest';
import { createTelemetryRecorder, type TelemetryEvent } from '../telemetry';

describe('telemetry recorder', () => {
  it('sequences per session with sinceLastMs and forwards to the sink', () => {
    let t = 1000;
    const sink = vi.fn<(e: TelemetryEvent) => void>();
    const rec = createTelemetryRecorder(sink, { clock: () => t });
    rec.record('s1', 'session_start');
    t = 1250;
    rec.record('s1', 'user_message', { content: 'hi' });
    rec.record('s2', 'session_start');
    expect(sink.mock.calls.map((c) => c[0])).toMatchObject([
      { sessionId: 's1', seq: 0, sinceLastMs: 0, type: 'session_start' },
      { sessionId: 's1', seq: 1, sinceLastMs: 250, type: 'user_message', data: { content: 'hi' } },
      { sessionId: 's2', seq: 0, sinceLastMs: 0 },
    ]);
  });
  it('captures sink failures without throwing', async () => {
    const rec = createTelemetryRecorder(() => Promise.reject(new Error('db')));
    rec.record('s', 'error');
    await new Promise((r) => setTimeout(r, 0));
    expect(rec.errors()).toHaveLength(1);
    const sync = createTelemetryRecorder(() => { throw new Error('boom'); });
    sync.record('s', 'error');
    expect(sync.errors()).toHaveLength(1);
  });
});
