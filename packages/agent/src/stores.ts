import { nowIso, type ISODate } from '@de_canter/apogee-kernel';
import type { AgentMessage } from './messages';

export interface SessionRecord {
  id: string;
  ownerId: string;
  title: string;
  context: unknown;
  messageCount: number;
  createdAt: ISODate;
  updatedAt: ISODate;
  lastMessageAt?: ISODate;
}

export type NewSessionRecord = Omit<SessionRecord, 'createdAt' | 'updatedAt' | 'messageCount'>;
export type SessionPatch = Partial<Pick<SessionRecord, 'title' | 'context' | 'messageCount' | 'lastMessageAt'>>;

/** Persistence port for session metadata. Hosts implement with their store. */
export interface SessionStore {
  create(record: NewSessionRecord): Promise<SessionRecord>;
  get(id: string): Promise<SessionRecord | undefined>;
  update(id: string, patch: SessionPatch): Promise<SessionRecord>;
  /** Newest first by updatedAt. */
  list(ownerId: string): Promise<SessionRecord[]>;
  delete(id: string): Promise<void>;
}

/** Persistence port for messages. `replace` exists for compaction. */
export interface MessageStore {
  append(sessionId: string, message: AgentMessage): Promise<void>;
  list(sessionId: string): Promise<AgentMessage[]>;
  replace(sessionId: string, messages: AgentMessage[]): Promise<void>;
}

export class SessionNotFoundError extends Error {
  constructor(id: string) {
    super(`Session not found: ${id}`);
    this.name = 'SessionNotFoundError';
  }
}

export function createInMemorySessionStore(now: () => ISODate = nowIso): SessionStore {
  const rows = new Map<string, SessionRecord>();
  return {
    create(r) {
      const at = now();
      const rec: SessionRecord = { ...r, messageCount: 0, createdAt: at, updatedAt: at };
      rows.set(rec.id, rec);
      return Promise.resolve(rec);
    },
    get: (id) => Promise.resolve(rows.get(id)),
    update(id, patch) {
      const cur = rows.get(id);
      if (!cur) return Promise.reject(new SessionNotFoundError(id));
      const next: SessionRecord = { ...cur, ...patch, updatedAt: now() };
      rows.set(id, next);
      return Promise.resolve(next);
    },
    list(ownerId) {
      return Promise.resolve([...rows.values()].filter((r) => r.ownerId === ownerId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    },
    delete(id) {
      rows.delete(id);
      return Promise.resolve();
    },
  };
}

export function createInMemoryMessageStore(): MessageStore {
  const rows = new Map<string, AgentMessage[]>();
  return {
    append(sessionId, message) {
      const list = rows.get(sessionId) ?? [];
      list.push(message);
      rows.set(sessionId, list);
      return Promise.resolve();
    },
    list: (sessionId) => Promise.resolve([...(rows.get(sessionId) ?? [])]),
    replace(sessionId, messages) {
      rows.set(sessionId, [...messages]);
      return Promise.resolve();
    },
  };
}

export interface SessionRegistry<T> {
  get(id: string): T | undefined;
  set(id: string, value: T): void;
  delete(id: string): void;
  /** Evict entries idle longer than `idleMs`; returns their ids. */
  sweep(): string[];
  size(): number;
}

/** In-process cache of live sessions with idle-based eviction (not absolute TTL). */
export function createSessionRegistry<T>(opts: { idleMs: number; now?: () => number }): SessionRegistry<T> {
  const now = opts.now ?? (() => Date.now());
  const entries = new Map<string, { value: T; lastTouched: number }>();
  return {
    get(id) {
      const e = entries.get(id);
      if (!e) return undefined;
      e.lastTouched = now();
      return e.value;
    },
    set(id, value) { entries.set(id, { value, lastTouched: now() }); },
    delete(id) { entries.delete(id); },
    sweep() {
      const cutoff = now() - opts.idleMs;
      const evicted: string[] = [];
      for (const [id, e] of entries) {
        if (e.lastTouched < cutoff) { entries.delete(id); evicted.push(id); }
      }
      return evicted;
    },
    size: () => entries.size,
  };
}
