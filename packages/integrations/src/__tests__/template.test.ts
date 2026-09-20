import { describe, expect, it } from 'vitest';
import { IntegrationsError } from '../errors';
import { findVaultRefs, interpolate, interpolateObject, resolvePath } from '../template';

const scope = { ctx: { yard: { name: 'north', city: 'Austin' }, total: 2250 }, vars: { baseUrl: 'https://api.mock.apogee.build' }, secrets: { api_key: 'demo-key-123' } };

describe('resolvePath', () => {
  it('walks objects and arrays', () => {
    expect(resolvePath({ a: { b: [{ c: 1 }] } }, 'a.b.0.c')).toBe(1);
    expect(resolvePath({ a: 1 }, 'a.b')).toBeUndefined();
    expect(resolvePath(null, 'a')).toBeUndefined();
  });
});

describe('interpolate', () => {
  it('reads the three roots and renders missing values as empty', () => {
    expect(interpolate('{{vars.baseUrl}}/geocode?q={{ctx.yard.city}}&key={{vault:api_key}}&n={{ total }}&x={{missing.path}}', scope)).toBe('https://api.mock.apogee.build/geocode?q=Austin&key=demo-key-123&n=2250&x=');
  });
  it('can keep unresolved vault references and can fail on missing values', () => {
    expect(interpolate('k={{vault:other}}', { ctx: {} }, { keepUnresolvedVault: true })).toBe('k={{vault:other}}');
    expect(interpolate('k={{vault:other}}', { ctx: {} })).toBe('k=');
    expect(() => interpolate('{{ctx.nope}}', scope, { onMissing: 'error' })).toThrow(IntegrationsError);
    expect(() => interpolate('{{ctx.nope}}', scope, { onMissing: 'error' })).toThrow(/ctx\.nope/);
  });
  it('stringifies objects as JSON', () => {
    expect(interpolate('{{ctx.yard}}', scope)).toBe('{"name":"north","city":"Austin"}');
  });
});

describe('findVaultRefs and interpolateObject', () => {
  it('collects unique vault keys and walks nested values', () => {
    expect(findVaultRefs('a {{vault:x}} b {{vault:y}} {{vault:x}} {{ctx.z}}')).toEqual(['x', 'y']);
    expect(interpolateObject({ url: '{{vars.baseUrl}}', nested: { list: ['{{ctx.yard.name}}', 2, null] }, n: 3 }, scope)).toEqual({ url: 'https://api.mock.apogee.build', nested: { list: ['north', 2, null] }, n: 3 });
  });
});
