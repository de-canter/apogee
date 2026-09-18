import { z } from 'zod';
import { KernelError } from './errors';
import { RefSchema, type Ref } from './ref';
import { ISODateSchema, nowIso, type ISODate } from './time';

export interface LifecycleTransition<S extends string> { name: string; from: S | readonly S[]; to: S }

/** A declaration of states and legal transitions. The kernel declares; workflow-engine executes. */
export interface LifecycleDefinition<S extends string> {
  states: readonly S[];
  initial: S;
  terminal: readonly S[];
  transitions: readonly LifecycleTransition<S>[];
}

export const LifecycleStateSchema = z.object({
  state: z.string().min(1),
  since: ISODateSchema,
  reason: z.string().min(1).optional(),
  by: RefSchema.optional(),
});
export interface LifecycleState<S extends string> { state: S; since: ISODate; reason?: string; by?: Ref }

export interface TransitionOptions { at?: ISODate; by?: Ref; reason?: string }

export class InvalidLifecycleError extends KernelError {
  constructor(msg: string) { super(msg, 'INVALID_LIFECYCLE'); }
}
export class IllegalTransitionError extends KernelError {
  constructor(from: string, to: string) { super(`Illegal transition ${from} -> ${to}`, 'ILLEGAL_TRANSITION'); }
}

export interface Lifecycle<S extends string> {
  readonly definition: LifecycleDefinition<S>;
  readonly stateSchema: z.ZodType<S>;
  can(from: S, to: S): boolean;
  next(from: S): readonly LifecycleTransition<S>[];
  assertTransition(from: S, to: S): LifecycleTransition<S>;
  isTerminal(s: S): boolean;
  initialState(opts?: TransitionOptions): LifecycleState<S>;
  transition(current: LifecycleState<S>, to: S, opts?: TransitionOptions): LifecycleState<S>;
}

function froms<S extends string>(t: LifecycleTransition<S>): readonly S[] {
  return Array.isArray(t.from) ? (t.from as readonly S[]) : [t.from as S];
}

export function defineLifecycle<const S extends string>(def: LifecycleDefinition<S>): Lifecycle<S> {
  const known = new Set<string>(def.states);
  const terminal = new Set<string>(def.terminal);
  if (!known.has(def.initial)) throw new InvalidLifecycleError(`initial state ${def.initial} not in states`);
  for (const t of def.terminal) if (!known.has(t)) throw new InvalidLifecycleError(`terminal state ${t} not in states`);
  for (const t of def.transitions) {
    for (const f of froms(t)) {
      if (!known.has(f)) throw new InvalidLifecycleError(`transition ${t.name} from unknown state ${f}`);
      if (terminal.has(f)) throw new InvalidLifecycleError(`transition ${t.name} leaves terminal state ${f}`);
    }
    if (!known.has(t.to)) throw new InvalidLifecycleError(`transition ${t.name} to unknown state ${t.to}`);
  }
  const stateSchema = z.enum([...def.states] as [S, ...S[]]);

  const next = (from: S): readonly LifecycleTransition<S>[] => def.transitions.filter((t) => froms(t).includes(from));
  const can = (from: S, to: S): boolean => next(from).some((t) => t.to === to);
  const assertTransition = (from: S, to: S): LifecycleTransition<S> => {
    const t = next(from).find((x) => x.to === to);
    if (!t) throw new IllegalTransitionError(from, to);
    return t;
  };
  const stamp = (state: S, opts: TransitionOptions): LifecycleState<S> => ({
    state,
    since: opts.at ?? nowIso(),
    ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
    ...(opts.by !== undefined ? { by: opts.by } : {}),
  });

  return Object.freeze({
    definition: def,
    stateSchema,
    can,
    next,
    assertTransition,
    isTerminal: (s: S) => terminal.has(s),
    initialState: (opts: TransitionOptions = {}) => stamp(def.initial, opts),
    transition: (current: LifecycleState<S>, to: S, opts: TransitionOptions = {}) => {
      assertTransition(current.state, to);
      return stamp(to, opts);
    },
  });
}
