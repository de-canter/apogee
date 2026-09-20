import { nowIso, sameRef, type ISODate, type Ref } from '@de_canter/apogee-kernel';

export type ExecutionStatus = 'success' | 'failure' | 'circuit_open' | 'rate_limited' | 'trigger_skip' | 'dry_run' | 'inbound' | 'manual';

/** One execution, outbound or inbound, with secrets already masked. */
export interface ExecutionRecord {
  traceId: string;
  at: ISODate;
  patternId: string;
  direction: 'outbound' | 'inbound';
  status: ExecutionStatus;
  subject?: Ref;
  request?: { method: string; url: string; headers: Record<string, string>; bodyPreview?: string };
  response?: { status?: number; bodyPreview?: string; output?: Record<string, unknown> };
  error?: string;
  latencyMs: number;
  attempts: number;
  aiProcessed: boolean;
  drift?: boolean;
  metadata?: Record<string, unknown>;
}

export interface HealthSummary {
  patternId: string;
  total: number;
  success: number;
  failure: number;
  circuitOpen: number;
  rateLimited: number;
  successRate: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  lastAt?: ISODate;
}

export interface ExecutionFilter { patternId?: string; status?: ExecutionStatus; subject?: Ref; direction?: 'outbound' | 'inbound' }

export type ExecutionRecordInput = Omit<ExecutionRecord, 'at'> & { at?: ISODate };

export interface ExecutionAuditSink {
  /** Stamps `at` when the caller leaves it out. */
  record(r: ExecutionRecordInput): Promise<void>;
  get(traceId: string): Promise<ExecutionRecord | undefined>;
  /** Newest first. */
  list(filter?: ExecutionFilter, opts?: { limit?: number; offset?: number }): Promise<{ entries: ExecutionRecord[]; total: number }>;
  health(patternId?: string, sinceMs?: number): Promise<HealthSummary[]>;
}

export const PREVIEW_CHARS = 2000;
export const DEFAULT_HEALTH_WINDOW_MS = 24 * 3_600_000;

export function preview(text: string): string {
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
}

export function createInMemoryExecutionAudit(opts: { now?: () => ISODate; clock?: () => number } = {}): ExecutionAuditSink {
  const now = opts.now ?? nowIso;
  // The health window is measured against the same clock that stamps records,
  // so an injected `now` never drifts away from a real-time window.
  const clock = opts.clock ?? (() => Date.parse(now()));
  const records: ExecutionRecord[] = [];
  const seq = new Map<string, number>();
  const clone = (r: ExecutionRecord): ExecutionRecord => structuredClone(r);
  const matches = (r: ExecutionRecord, f: ExecutionFilter): boolean =>
    (f.patternId === undefined || r.patternId === f.patternId) &&
    (f.status === undefined || r.status === f.status) &&
    (f.direction === undefined || r.direction === f.direction) &&
    (f.subject === undefined || (r.subject !== undefined && sameRef(r.subject, f.subject)));
  return {
    record(r) {
      const stored = clone({ ...r, at: r.at ?? now() });
      records.push(stored);
      seq.set(stored.traceId, records.length);
      return Promise.resolve();
    },
    get: (traceId) => Promise.resolve(records.filter((r) => r.traceId === traceId).map(clone)[0]),
    list(filter = {}, page = {}) {
      const all = records.filter((r) => matches(r, filter)).sort((a, b) => b.at.localeCompare(a.at) || seq.get(b.traceId)! - seq.get(a.traceId)!);
      const offset = page.offset ?? 0;
      const limit = page.limit ?? 50;
      return Promise.resolve({ entries: all.slice(offset, offset + limit).map(clone), total: all.length });
    },
    health(patternId, sinceMs = DEFAULT_HEALTH_WINDOW_MS) {
      const since = new Date(clock() - sinceMs).toISOString();
      const groups = new Map<string, ExecutionRecord[]>();
      for (const r of records) {
        if (patternId !== undefined && r.patternId !== patternId) continue;
        if (r.at < since && sinceMs !== Number.POSITIVE_INFINITY) continue;
        groups.set(r.patternId, [...(groups.get(r.patternId) ?? []), r]);
      }
      const out: HealthSummary[] = [...groups.entries()].map(([id, rs]) => {
        const count = (s: ExecutionStatus): number => rs.filter((r) => r.status === s).length;
        const executed = rs.filter((r) => r.status === 'success' || r.status === 'failure');
        return {
          patternId: id,
          total: rs.length,
          success: count('success'),
          failure: count('failure'),
          circuitOpen: count('circuit_open'),
          rateLimited: count('rate_limited'),
          successRate: executed.length === 0 ? 0 : count('success') / executed.length,
          avgLatencyMs: executed.length === 0 ? 0 : Math.round(executed.reduce((s, r) => s + r.latencyMs, 0) / executed.length),
          maxLatencyMs: rs.reduce((m, r) => Math.max(m, r.latencyMs), 0),
          lastAt: rs.map((r) => r.at).sort().at(-1)!,
        };
      });
      return Promise.resolve(out.sort((a, b) => b.total - a.total || a.patternId.localeCompare(b.patternId)));
    },
  };
}
