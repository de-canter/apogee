import { z } from 'zod';
import { InvalidLifecycleError, nowIso, type Lifecycle } from '@de_canter/apogee-kernel';
import { action, deriveActions, type ActionSource, type Current, type TransitionRule, type ActionRule } from './actions';
import { guarded, type CapabilitySpec, type RunContext } from './capability';
import { describeEnvelope, envelopeSchema, listEnvelopeSchema, type ActionIntent, type Envelope, type ListEnvelope } from './contract';
import { ChatKitError, type IllegalTransitionDetails } from './errors';

export type { Current } from './actions';

export interface CallContext<TCtx, TPrincipal> { ctx: TCtx; principal: TPrincipal }
export interface ExecuteContext<TCtx, TPrincipal, TView, S extends string> extends CallContext<TCtx, TPrincipal> {
  id: string;
  current: Current<TView, S>;
}

/** An object schema whose parsed shape is a plain record. `id` is added by the kit and must not be declared. */
export type InputSchema = z.ZodObject<z.ZodRawShape>;

export interface TransitionDef<TCtx, TPrincipal, TView, S extends string> {
  from: S | readonly S[];
  to: S | readonly S[];
  input: InputSchema;
  title: string;
  description?: string | undefined;
  intent?: ActionIntent | undefined;
  when?: ((current: Current<TView, S>) => boolean) | undefined;
  // Method signature on purpose: parameters are bivariant, so hosts may type `input` as z.infer<typeof TheirSchema>.
  execute(input: Record<string, unknown>, c: ExecuteContext<TCtx, TPrincipal, TView, S>): Promise<Current<TView, S>>;
}

export interface QueryDef<TCtx, TPrincipal, TView, S extends string> {
  input: InputSchema;
  title: string;
  description?: string | undefined;
  intent?: ActionIntent | undefined;
  when?: ((current: Current<TView, S>) => boolean) | undefined;
  execute(input: Record<string, unknown>, c: ExecuteContext<TCtx, TPrincipal, TView, S>): Promise<{ view: TView }>;
}

export interface CreateDef<TCtx, TPrincipal, TView, S extends string> {
  input: InputSchema;
  title: string;
  description?: string | undefined;
  execute(input: Record<string, unknown>, c: CallContext<TCtx, TPrincipal>): Promise<{ id: string; state: S; view: TView }>;
}

export interface ListDef<TCtx, TPrincipal, TView, S extends string> {
  input: InputSchema;
  title: string;
  description?: string | undefined;
  execute(input: Record<string, unknown>, c: CallContext<TCtx, TPrincipal>): Promise<{ items: Array<{ id: string; state: S; view: TView }>; next_cursor: string | null }>;
}

export interface ResourceDef<TCtx, TPrincipal, TView, S extends string> {
  name: string;
  lifecycle: Lifecycle<S>;
  view: z.ZodType<TView>;
  load(id: string, c: CallContext<TCtx, TPrincipal>): Promise<Current<TView, S> | null>;
  create?: CreateDef<TCtx, TPrincipal, TView, S> | undefined;
  list?: ListDef<TCtx, TPrincipal, TView, S> | undefined;
  transitions: Record<string, TransitionDef<TCtx, TPrincipal, TView, S>>;
  queries?: Record<string, QueryDef<TCtx, TPrincipal, TView, S>> | undefined;
  policy?: ((t: { name: string; to: readonly S[] }, current: Current<TView, S>, principal: TPrincipal) => boolean) | undefined;
  describe?: ((view: TView, state: S) => string) | undefined;
  ui?: Record<string, string> | undefined;
}

export interface Resource<TCtx, TPrincipal, TView, S extends string> extends ActionSource<TView, S, TPrincipal> {
  lifecycle: Lifecycle<S>;
  view: z.ZodType<TView>;
  capabilities(): CapabilitySpec<TCtx, TPrincipal>[];
  envelope(id: string, current: Current<TView, S>, principal: TPrincipal, extra?: { entitlement?: unknown; ui?: string | undefined }): Envelope<TView>;
}

export const RESERVED_CAPABILITY_NAMES = ['get', 'list', 'create'] as const;
const NAME_RE = /^[a-z][a-z0-9_]*$/;
const IdSchema = z.string().min(1);

/** Throws when `name` is not snake_case. Shared by defineResource and defineCapability. */
export function assertSnakeCase(kind: string, name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`${kind} name "${name}" must be snake_case`);
}

function arr<S extends string>(s: S | readonly S[]): readonly S[] {
  return Array.isArray(s) ? (s as readonly S[]) : [s as S];
}

export function defineResource<TCtx, TPrincipal, TView, S extends string>(
  def: ResourceDef<TCtx, TPrincipal, TView, S>,
): Resource<TCtx, TPrincipal, TView, S> {
  if (!NAME_RE.test(def.name)) throw new InvalidLifecycleError(`resource name "${def.name}" must be snake_case`);
  const states = new Set<string>(def.lifecycle.definition.states);
  const queries = def.queries ?? {};
  const seen = new Set<string>();
  const checkName = (kind: string, name: string, input: InputSchema): void => {
    if (!NAME_RE.test(name)) throw new InvalidLifecycleError(`${kind} "${name}" must be snake_case`);
    if ((RESERVED_CAPABILITY_NAMES as readonly string[]).includes(name)) throw new InvalidLifecycleError(`${kind} "${name}" is reserved`);
    if (seen.has(name)) throw new InvalidLifecycleError(`${kind} "${name}" collides with another capability`);
    if ('id' in input.shape) throw new InvalidLifecycleError(`${kind} "${name}" input must not declare "id"; the kit adds it`);
    seen.add(name);
  };
  // Name validation (reserved/collision/id) runs for every transition and query before any
  // lifecycle legality check, so a name collision is always reported ahead of an unrelated
  // "from -> to" error on either side of the collision.
  for (const [name, t] of Object.entries(def.transitions)) checkName('transition', name, t.input);
  for (const [name, q] of Object.entries(queries)) checkName('query', name, q.input);

  const transitionRules: Record<string, TransitionRule<TView, S>> = {};
  for (const [name, t] of Object.entries(def.transitions)) {
    const from = arr(t.from);
    const to = arr(t.to);
    for (const s of [...from, ...to]) if (!states.has(s)) throw new InvalidLifecycleError(`transition "${name}" names unknown state ${s}`);
    for (const f of from) for (const tt of to) if (!def.lifecycle.can(f, tt)) throw new InvalidLifecycleError(`transition "${name}": ${f} -> ${tt} is not a lifecycle transition`);
    transitionRules[name] = { from, to, title: t.title, intent: t.intent, when: t.when };
  }
  const queryRules: Record<string, ActionRule<TView, S>> = {};
  for (const [name, q] of Object.entries(queries)) {
    queryRules[name] = { title: q.title, intent: q.intent, when: q.when };
  }

  const output = envelopeSchema(def.view);
  const listOutput = listEnvelopeSchema(def.view);
  const uiFor = (local: string): string | undefined => def.ui?.[local];
  const describeOne = (e: Envelope<TView>): string =>
    def.describe ? def.describe(e.data, e.state as S) : describeEnvelope(e);
  const describeAny = (e: Envelope | ListEnvelope): string =>
    'items' in e ? describeEnvelope(e) : describeOne(e as Envelope<TView>);

  const self: Resource<TCtx, TPrincipal, TView, S> = {
    name: def.name,
    lifecycle: def.lifecycle,
    view: def.view,
    transitionRules,
    queryRules,
    policy: def.policy,
    envelope(id, current, principal, extra = {}) {
      const e: Envelope<TView> = {
        resource: def.name, id, state: current.state, data: current.view,
        allowed_next_actions: deriveActions(self, id, current, principal), at: nowIso(),
      };
      if (extra.ui !== undefined) e.ui = { resource_uri: extra.ui };
      if (extra.entitlement !== undefined) e.entitlement = extra.entitlement;
      return e;
    },
    capabilities() {
      const caps: CapabilitySpec<TCtx, TPrincipal>[] = [];
      const cap = (name: string, title: string, description: string | undefined, input: z.ZodType, out: z.ZodType, ui: string | undefined,
        run: CapabilitySpec<TCtx, TPrincipal>['run']): void => {
        caps.push({ name: `${def.name}_${name}`, title, description: description ?? title, resource: def.name, input, output: out, ui, describe: describeAny, run });
      };

      const checkView = (view: TView, where: string): void => {
        const r = def.view.safeParse(view);
        if (!r.success) throw new ChatKitError('INTERNAL', `${where} returned an invalid view`, { details: r.error.issues });
      };
      const loadOr404 = async (id: string, c: RunContext<TCtx, TPrincipal>): Promise<Current<TView, S>> => {
        const current = await def.load(id, { ctx: c.ctx, principal: c.principal });
        if (!current) throw new ChatKitError('NOT_FOUND', `No ${def.name} ${id}`);
        checkView(current.view, `${def.name} load`);
        return current;
      };

      cap('get', `Get ${def.name}`, undefined, z.object({ id: IdSchema }), output, uiFor('get'), async (input, c) => {
        const { id } = input as { id: string };
        const current = await loadOr404(id, c);
        return self.envelope(id, current, c.principal, { ui: uiFor('get') });
      });

      if (def.list) {
        const l = def.list;
        cap('list', l.title, l.description, l.input, listOutput, uiFor('list'), async (input, c) => {
          const call = { principal: c.principal, capability: `${def.name}_list`, resource: def.name, input };
          const { result } = await guarded(c.entitlement, call, () => l.execute(input as Record<string, unknown>, { ctx: c.ctx, principal: c.principal }), c.onError);
          for (const i of result.items) checkView(i.view, 'list');
          const e: ListEnvelope<TView> = {
            resource: def.name,
            items: result.items.map((i) => self.envelope(i.id, { state: i.state, view: i.view }, c.principal, { ui: uiFor('get') })),
            next_cursor: result.next_cursor,
            allowed_next_actions: def.create ? [action(`${def.name}_create`, def.create.title, {})] : [],
            at: nowIso(),
          };
          const ui = uiFor('list');
          if (ui !== undefined) e.ui = { resource_uri: ui };
          return e;
        });
      }

      if (def.create) {
        const cr = def.create;
        cap('create', cr.title, cr.description, cr.input, output, uiFor('create'), async (input, c) => {
          const call = { principal: c.principal, capability: `${def.name}_create`, resource: def.name, input };
          const { result, entitlementView } = await guarded(c.entitlement, call, () => cr.execute(input as Record<string, unknown>, { ctx: c.ctx, principal: c.principal }), c.onError);
          checkView(result.view, 'create');
          return self.envelope(result.id, { state: result.state, view: result.view }, c.principal, { ui: uiFor('create') ?? uiFor('get'), entitlement: entitlementView });
        });
      }

      for (const [name, t] of Object.entries(def.transitions)) {
        const rule = transitionRules[name]!;
        cap(name, t.title, t.description, t.input.extend({ id: IdSchema }), output, uiFor(name), async (input, c) => {
          const { id, ...rest } = input as { id: string } & Record<string, unknown>;
          const current = await loadOr404(id, c);
          if (!rule.from.includes(current.state)) {
            const allowed = deriveActions(self, id, current, c.principal);
            const details: IllegalTransitionDetails = { resource: def.name, id, from: current.state, attempted: `${def.name}_${name}`, allowed: allowed.map((a) => a.capability) };
            throw new ChatKitError('ILLEGAL_TRANSITION', `${def.name} ${id} is ${current.state}; ${def.name}_${name} is not allowed`, { details, allowed_next_actions: allowed });
          }
          const call = { principal: c.principal, capability: `${def.name}_${name}`, resource: def.name, input };
          const { result, entitlementView } = await guarded(c.entitlement, call, () => t.execute(rest, { ctx: c.ctx, principal: c.principal, id, current }), c.onError);
          if (!rule.to.includes(result.state)) throw new ChatKitError('INTERNAL', `${def.name}_${name} returned undeclared state ${result.state}`);
          checkView(result.view, `${def.name}_${name}`);
          return self.envelope(id, result, c.principal, { ui: uiFor(name) ?? uiFor('get'), entitlement: entitlementView });
        });
      }

      for (const [name, q] of Object.entries(queries)) {
        cap(name, q.title, q.description, q.input.extend({ id: IdSchema }), output, uiFor(name), async (input, c) => {
          const { id, ...rest } = input as { id: string } & Record<string, unknown>;
          const current = await loadOr404(id, c);
          const call = { principal: c.principal, capability: `${def.name}_${name}`, resource: def.name, input };
          const { result, entitlementView } = await guarded(c.entitlement, call, () => q.execute(rest, { ctx: c.ctx, principal: c.principal, id, current }), c.onError);
          checkView(result.view, `${def.name}_${name}`);
          return self.envelope(id, { state: current.state, view: result.view }, c.principal, { ui: uiFor(name) ?? uiFor('get'), entitlement: entitlementView });
        });
      }
      return caps;
    },
  };
  return self;
}
