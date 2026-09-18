import { describe, expect, it } from 'vitest';
import { ref } from '../ref';
import { interval, isoDate } from '../time';
import { activeRelationships, activeRoles, partiesInRole, relationship, role, rolesOf } from '../role';

const order = ref('Order', 'o1');
const alice = ref('Party', 'alice');
const bob = ref('Party', 'bob');
const jan = isoDate('2026-01-15');
const mar = isoDate('2026-03-15');

describe('Role', () => {
  const roles = [
    role(alice, order, 'buyer'),
    role(bob, order, 'buyer', { interval: interval(isoDate('2026-02-01')) }),
    role(bob, order, 'lender', { interval: interval(isoDate('2026-01-01'), isoDate('2026-02-01')) }),
  ];
  it('is a (party, context, roleType) triple, never an attribute on the party', () => {
    expect(roles[0]).toEqual({ party: alice, context: order, roleType: 'buyer' });
  });
  it('filters by time: roles without interval are always active', () => {
    expect(activeRoles(roles, jan).map((r) => `${r.party.id}:${r.roleType}`)).toEqual(['alice:buyer', 'bob:lender']);
    expect(activeRoles(roles, mar).map((r) => `${r.party.id}:${r.roleType}`)).toEqual(['alice:buyer', 'bob:buyer']);
  });
  it('queries parties in a role and roles of a party', () => {
    expect(partiesInRole(roles, order, 'buyer', mar).map((p) => p.id)).toEqual(['alice', 'bob']);
    expect(rolesOf(roles, bob, jan).map((r) => r.roleType)).toEqual(['lender']);
  });
});

describe('Relationship', () => {
  it('is directional with an optional interval', () => {
    const owns = relationship(alice, ref('Property', 'p1'), 'owns', { interval: interval(isoDate('2026-01-01'), isoDate('2026-03-01')) });
    expect(activeRelationships([owns], jan)).toHaveLength(1);
    expect(activeRelationships([owns], mar)).toHaveLength(0);
  });
});
