import { nowIso, sameRef, type ISODate, type Ref } from '@apogee/kernel';

/** One rule firing: which rule, in what context, what the assistant did, and what the user chose. */
export interface RuleAuditEntry {
  id: string;
  at: ISODate;
  ruleId: string;
  ruleName: string;
  category: string;
  /** Host-named event, e.g. 'rental.created' or 'rule.confirmed'. */
  trigger: string;
  sessionId?: string;
  actor?: Ref;
  subject?: Ref;
  conditionsMatched: Record<string, unknown>;
  action: string;
  suggestedActions: string[];
  userChoice?: string;
  success: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

export type RuleAuditInput = Omit<RuleAuditEntry, 'id' | 'at' | 'success' | 'conditionsMatched' | 'suggestedActions'> &
  Partial<Pick<RuleAuditEntry, 'success' | 'conditionsMatched' | 'suggestedActions'>>;

export interface RuleAuditFilter {
  ruleId?: string;
  category?: string;
  sessionId?: string;
  trigger?: string;
  subject?: Ref;
  from?: ISODate;
  to?: ISODate;
  success?: boolean;
}

export interface RuleAuditPage { entries: RuleAuditEntry[]; total: number; hasMore: boolean }
export interface RuleAuditStats { total: number; byCategory: Record<string, number>; byTrigger: Record<string, number>; successRate: number }

export interface RuleAuditSink {
  record(input: RuleAuditInput): Promise<RuleAuditEntry>;
  outcome(id: string, userChoice: string, success?: boolean, error?: string): Promise<RuleAuditEntry | undefined>;
  /** Newest first. */
  query(filter?: RuleAuditFilter, opts?: { limit?: number; offset?: number }): Promise<RuleAuditPage>;
  stats(filter?: RuleAuditFilter): Promise<RuleAuditStats>;
}

export const DEFAULT_AUDIT_PAGE = 50;

function matches(e: RuleAuditEntry, f: RuleAuditFilter): boolean {
  if (f.ruleId !== undefined && e.ruleId !== f.ruleId) return false;
  if (f.category !== undefined && e.category !== f.category) return false;
  if (f.sessionId !== undefined && e.sessionId !== f.sessionId) return false;
  if (f.trigger !== undefined && e.trigger !== f.trigger) return false;
  if (f.subject !== undefined && (e.subject === undefined || !sameRef(e.subject, f.subject))) return false;
  if (f.success !== undefined && e.success !== f.success) return false;
  if (f.from !== undefined && e.at < f.from) return false;
  if (f.to !== undefined && e.at > f.to) return false;
  return true;
}

const tally = (items: string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const k of items) out[k] = (out[k] ?? 0) + 1;
  return out;
};

export function createInMemoryRuleAudit(opts: { now?: () => ISODate } = {}): RuleAuditSink {
  const now = opts.now ?? nowIso;
  const entries: RuleAuditEntry[] = [];
  const select = (filter: RuleAuditFilter): RuleAuditEntry[] => entries.filter((e) => matches(e, filter)).sort((a, b) => b.at.localeCompare(a.at));
  return {
    record(input) {
      const entry: RuleAuditEntry = { ...input, id: crypto.randomUUID(), at: now(), success: input.success ?? true, conditionsMatched: input.conditionsMatched ?? {}, suggestedActions: input.suggestedActions ?? [] };
      entries.push(entry);
      return Promise.resolve({ ...entry });
    },
    outcome(id, userChoice, success = true, error) {
      const e = entries.find((x) => x.id === id);
      if (!e) return Promise.resolve(undefined);
      e.userChoice = userChoice;
      e.success = success;
      if (error !== undefined) e.error = error;
      else delete e.error;
      return Promise.resolve({ ...e });
    },
    query(filter = {}, page = {}) {
      const limit = page.limit ?? DEFAULT_AUDIT_PAGE;
      const offset = page.offset ?? 0;
      const all = select(filter);
      const slice = all.slice(offset, offset + limit).map((e) => ({ ...e }));
      return Promise.resolve({ entries: slice, total: all.length, hasMore: offset + limit < all.length });
    },
    stats(filter = {}) {
      const all = select(filter);
      const ok = all.filter((e) => e.success).length;
      return Promise.resolve({
        total: all.length,
        byCategory: tally(all.map((e) => e.category)),
        byTrigger: tally(all.map((e) => e.trigger)),
        successRate: all.length === 0 ? 1 : ok / all.length,
      });
    },
  };
}
