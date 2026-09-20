import { nowIso, type ISODate } from '@de_canter/apogee-kernel';
import { useEffect, useMemo } from 'react';

export type ArtifactEventType = 'artifact_shown' | 'artifact_field_change' | 'artifact_submit' | 'artifact_action';

export interface ArtifactEvent {
  eventType: ArtifactEventType;
  artifactType: string;
  artifactId: string;
  data?: Record<string, unknown>;
  at: ISODate;
}

export type ArtifactEventSink = (events: ArtifactEvent[]) => void | Promise<void>;

export interface ArtifactEventsOptions {
  artifactType: string;
  artifactId: string;
  sink: ArtifactEventSink;
  debounceMs?: number;
  batchIntervalMs?: number;
  now?: () => ISODate;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface ArtifactEventsRecorder {
  recordShown(): void;
  recordFieldChange(fieldName: string, previousValue: unknown, newValue: unknown): void;
  recordSubmit(formData: Record<string, unknown>): void;
  recordAction(actionName: string): void;
  flush(): void;
  cleanup(): void;
}

/** Framework-free core so it can be tested with fake timers and reused outside React. */
export function createArtifactEventsRecorder(opts: ArtifactEventsOptions): ArtifactEventsRecorder {
  const debounceMs = opts.debounceMs ?? 300;
  const batchIntervalMs = opts.batchIntervalMs ?? 1000;
  const now = opts.now ?? nowIso;
  const setT = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const queue: ArtifactEvent[] = [];
  const pendingFields = new Map<string, { handle: unknown; event: ArtifactEvent }>();
  let batchHandle: unknown;

  const make = (eventType: ArtifactEventType, data?: Record<string, unknown>): ArtifactEvent =>
    ({ eventType, artifactType: opts.artifactType, artifactId: opts.artifactId, ...(data ? { data } : {}), at: now() });

  const flush = (): void => {
    if (batchHandle !== undefined) { clearT(batchHandle); batchHandle = undefined; }
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    void opts.sink(batch);
  };
  const enqueue = (e: ArtifactEvent): void => {
    queue.push(e);
    batchHandle ??= setT(flush, batchIntervalMs);
  };
  /** Move debounced field changes into the queue now (submit must not lose them). */
  const settleFields = (): void => {
    for (const [field, p] of pendingFields) {
      clearT(p.handle);
      pendingFields.delete(field);
      queue.push(p.event);
    }
  };

  return {
    recordShown: () => enqueue(make('artifact_shown')),
    recordFieldChange(fieldName, previousValue, newValue) {
      const existing = pendingFields.get(fieldName);
      if (existing) clearT(existing.handle);
      const event = make('artifact_field_change', { fieldName, previousValue: existing?.event.data?.['previousValue'] ?? previousValue, newValue });
      const handle = setT(() => { pendingFields.delete(fieldName); enqueue(event); }, debounceMs);
      pendingFields.set(fieldName, { handle, event });
    },
    recordSubmit(formData) {
      settleFields();
      queue.push(make('artifact_submit', { formData }));
      flush();
    },
    recordAction: (actionName) => enqueue(make('artifact_action', { actionName })),
    flush,
    cleanup() {
      settleFields();
      flush();
    },
  };
}

export function useArtifactEvents(opts: ArtifactEventsOptions): ArtifactEventsRecorder {
  const { artifactType, artifactId, sink, debounceMs, batchIntervalMs } = opts;
  const recorder = useMemo(
    () => createArtifactEventsRecorder({ artifactType, artifactId, sink, ...(debounceMs !== undefined ? { debounceMs } : {}), ...(batchIntervalMs !== undefined ? { batchIntervalMs } : {}) }),
    [artifactType, artifactId, sink, debounceMs, batchIntervalMs],
  );
  useEffect(() => () => recorder.cleanup(), [recorder]);
  return recorder;
}
