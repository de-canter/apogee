import type { ActionDescriptor, ActionIntent } from './contract';

export interface Current<TView, S extends string> { state: S; view: TView }

export interface ActionRule<TView, S extends string> {
  title: string;
  intent?: ActionIntent | undefined;
  when?: ((current: Current<TView, S>) => boolean) | undefined;
}
export interface TransitionRule<TView, S extends string> extends ActionRule<TView, S> {
  from: readonly S[];
  to: readonly S[];
}

/** @internal */
export interface ActionSource<TView, S extends string, TPrincipal> {
  name: string;
  transitionRules: Record<string, TransitionRule<TView, S>>;
  queryRules: Record<string, ActionRule<TView, S>>;
  policy?: ((t: { name: string; to: readonly S[] }, current: Current<TView, S>, principal: TPrincipal) => boolean) | undefined;
}

/** @internal */
export function action(capability: string, title: string, args: Record<string, unknown>, intent?: ActionIntent): ActionDescriptor {
  return intent === undefined ? { capability, title, args } : { capability, title, args, intent };
}

/** Spec §4.4: transitions legal from the state (narrowed by `when` and `policy`), then queries (narrowed by `when`). */
export function deriveActions<TView, S extends string, TPrincipal>(
  src: ActionSource<TView, S, TPrincipal>,
  id: string,
  current: Current<TView, S>,
  principal: TPrincipal,
): ActionDescriptor[] {
  const out: ActionDescriptor[] = [];
  for (const [name, t] of Object.entries(src.transitionRules)) {
    if (!t.from.includes(current.state)) continue;
    if (t.when && !t.when(current)) continue;
    if (src.policy && !src.policy({ name, to: t.to }, current, principal)) continue;
    out.push(action(`${src.name}_${name}`, t.title, { id }, t.intent));
  }
  for (const [name, q] of Object.entries(src.queryRules)) {
    if (q.when && !q.when(current)) continue;
    out.push(action(`${src.name}_${name}`, q.title, { id }, q.intent));
  }
  return out;
}
