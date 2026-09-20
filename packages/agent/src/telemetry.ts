import { nowIso, type ISODate } from '@de_canter/apogee-kernel';

export type TelemetryEventType =
  | 'session_start' | 'user_message' | 'assistant_message'
  | 'tool_start' | 'tool_complete' | 'tool_error'
  | 'artifact' | 'context_change' | 'compaction' | 'turn_end' | 'error';

export interface TelemetryEvent {
  sessionId: string;
  seq: number;
  at: ISODate;
  sinceLastMs: number;
  type: TelemetryEventType;
  data: Record<string, unknown>;
}

export type TelemetrySink = (event: TelemetryEvent) => void | Promise<void>;

export interface TelemetryRecorder {
  record(sessionId: string, type: TelemetryEventType, data?: Record<string, unknown>): void;
  /** Sink failures, never thrown into the agent loop. */
  errors(): unknown[];
}

export function createTelemetryRecorder(sink: TelemetrySink, opts: { now?: () => ISODate; clock?: () => number } = {}): TelemetryRecorder {
  const now = opts.now ?? nowIso;
  const clock = opts.clock ?? (() => Date.now());
  const state = new Map<string, { seq: number; last: number }>();
  const errors: unknown[] = [];
  return {
    record(sessionId, type, data = {}) {
      const t = clock();
      const s = state.get(sessionId) ?? { seq: 0, last: t };
      const event: TelemetryEvent = { sessionId, seq: s.seq, at: now(), sinceLastMs: t - s.last, type, data };
      state.set(sessionId, { seq: s.seq + 1, last: t });
      try {
        const out = sink(event);
        if (out instanceof Promise) out.catch((e: unknown) => { errors.push(e); });
      } catch (e) {
        errors.push(e);
      }
    },
    errors: () => [...errors],
  };
}
