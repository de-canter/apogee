import { z } from 'zod';
import { ProvenanceSchema } from './provenance';
import { RefSchema, sameRef, type Ref } from './ref';
import { IntervalSchema, intervalContains, type ISODate } from './time';

const temporal = { interval: IntervalSchema.optional(), provenance: ProvenanceSchema.optional() };

/** How a party participates in a context: (party, context, roleType). Never an attribute on the party. */
export const RoleSchema = z.object({ party: RefSchema, context: RefSchema, roleType: z.string().min(1), ...temporal });
export type Role = z.infer<typeof RoleSchema>;

/** Directional link between any two entities: ownership, custody, membership, hierarchy, succession. */
export const RelationshipSchema = z.object({ from: RefSchema, to: RefSchema, relationType: z.string().min(1), ...temporal });
export type Relationship = z.infer<typeof RelationshipSchema>;

type TemporalOpts = Partial<Pick<Role, 'interval' | 'provenance'>>;

export function role(party: Ref, context: Ref, roleType: string, opts: TemporalOpts = {}): Role {
  return RoleSchema.parse({ party, context, roleType, ...opts });
}
export function relationship(from: Ref, to: Ref, relationType: string, opts: TemporalOpts = {}): Relationship {
  return RelationshipSchema.parse({ from, to, relationType, ...opts });
}

function isActive(x: { interval?: Role['interval'] }, at: ISODate): boolean {
  return x.interval === undefined || intervalContains(x.interval, at);
}

export function activeRoles(roles: readonly Role[], at: ISODate): Role[] {
  return roles.filter((r) => isActive(r, at));
}
export function partiesInRole(roles: readonly Role[], context: Ref, roleType: string, at?: ISODate): Ref[] {
  return roles
    .filter((r) => sameRef(r.context, context) && r.roleType === roleType && (at === undefined || isActive(r, at)))
    .map((r) => r.party);
}
export function rolesOf(roles: readonly Role[], party: Ref, at?: ISODate): Role[] {
  return roles.filter((r) => sameRef(r.party, party) && (at === undefined || isActive(r, at)));
}
export function activeRelationships(rels: readonly Relationship[], at: ISODate): Relationship[] {
  return rels.filter((r) => isActive(r, at));
}
