import type { CapabilityInfo, CapabilitySpec } from './capability';
import type { Envelope, ListEnvelope } from './contract';
import { ChatKitError } from './errors';
import { allowAll, type AuthInfo, type EntitlementPort, type PrincipalResolver } from './ports';

export interface KitOptions<TCtx, TPrincipal> {
  resources: Array<{ capabilities(): CapabilitySpec<TCtx, TPrincipal>[] }>;
  capabilities?: CapabilitySpec<TCtx, TPrincipal>[] | undefined;
  ctx: TCtx;
  principal: PrincipalResolver<TPrincipal>;
  entitlement?: EntitlementPort<TPrincipal> | undefined;
  onError?: ((err: unknown, where: string) => void) | undefined;
}

export interface Kit {
  list(): CapabilityInfo[];
  get(name: string): CapabilityInfo | undefined;
  call(name: string, args: unknown, auth: AuthInfo | undefined): Promise<Envelope | ListEnvelope>;
  describe(name: string, result: Envelope | ListEnvelope): string;
}

const info = (c: CapabilityInfo): CapabilityInfo =>
  ({ name: c.name, title: c.title, description: c.description, resource: c.resource, input: c.input, output: c.output, ui: c.ui });

/** Spec §4.7: the one pipeline every projection goes through. */
export function createKit<TCtx, TPrincipal>(opts: KitOptions<TCtx, TPrincipal>): Kit {
  const specs = new Map<string, CapabilitySpec<TCtx, TPrincipal>>();
  const add = (c: CapabilitySpec<TCtx, TPrincipal>): void => {
    if (specs.has(c.name)) throw new Error(`createKit: duplicate capability "${c.name}"`);
    specs.set(c.name, c);
  };
  for (const r of opts.resources) for (const c of r.capabilities()) add(c);
  for (const c of opts.capabilities ?? []) add(c);

  const entitlement: EntitlementPort<TPrincipal> = opts.entitlement ?? allowAll;
  const onError = opts.onError ?? ((): void => undefined);

  return {
    list: () => [...specs.values()].map(info),
    get: (name) => { const c = specs.get(name); return c ? info(c) : undefined; },
    describe: (name, result) => {
      const c = specs.get(name);
      if (!c) throw new ChatKitError('NOT_FOUND', `Unknown capability ${name}`);
      return c.describe(result);
    },
    async call(name, args, auth) {
      const c = specs.get(name);
      if (!c) throw new ChatKitError('NOT_FOUND', `Unknown capability ${name}`);
      let principal: TPrincipal;
      try {
        principal = await opts.principal(auth);
      } catch (err) {
        if (ChatKitError.is(err)) throw err;
        throw new ChatKitError('UNAUTHENTICATED', 'Not authenticated');
      }
      const parsed = c.input.safeParse(args);
      if (!parsed.success) throw new ChatKitError('INVALID_INPUT', `Invalid input for ${name}`, { details: parsed.error.issues });
      try {
        return await c.run(parsed.data, { ctx: opts.ctx, principal, entitlement, onError });
      } catch (err) {
        if (ChatKitError.is(err)) {
          // Kit-generated INTERNAL errors (invalid view, undeclared state) are host bugs too.
          if (err.code === 'INTERNAL') onError(err, name);
          throw err;
        }
        onError(err, name);
        throw new ChatKitError('INTERNAL', 'Capability failed');
      }
    },
  };
}
