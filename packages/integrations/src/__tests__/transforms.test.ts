import { describe, expect, it } from 'vitest';
import { IntegrationsError } from '../errors';
import { applyMapping, applyTransform, TRANSFORMS } from '../transforms';

describe('applyTransform', () => {
  const cases: Array<[string, unknown, Record<string, unknown> | undefined, unknown]> = [
    ['uppercase', 'north', undefined, 'NORTH'], ['uppercase', 5, undefined, 5],
    ['lowercase', 'NORTH', undefined, 'north'], ['trim', '  x ', undefined, 'x'],
    ['to_number', '21.5', undefined, 21.5], ['to_number', 'x', undefined, 'x'],
    ['to_boolean', 'yes', undefined, true], ['to_boolean', '0', undefined, false],
    ['date_format', '2026-09-21T10:00:00Z', { format: 'date' }, '2026-09-21'], ['date_format', '2026-09-21', { format: 'iso' }, '2026-09-21T00:00:00.000Z'], ['date_format', 'nope', { format: 'date' }, 'nope'],
    ['cents_to_units', 225000, undefined, 2250], ['units_to_cents', 22.5, undefined, 2250],
    ['split', 'a,b,c', { delimiter: ',', index: 1 }, 'b'], ['split', 'a,b', undefined, ['a', 'b']],
    ['concat', 'x', { prefix: '<', suffix: '>' }, '<x>'], ['concat', ['a', 'b'], { separator: '-' }, 'a-b'],
    ['default_value', '', { default: 'n/a' }, 'n/a'], ['default_value', 'v', { default: 'n/a' }, 'v'],
    ['lookup', 'N', { map: { N: 'north' }, default: '?' }, 'north'], ['lookup', 'Z', { map: { N: 'north' }, default: '?' }, '?'],
    ['conditional', 5, { condition: 'gt', compareTo: 3, ifTrue: 'big', ifFalse: 'small' }, 'big'], ['conditional', 0, { condition: 'truthy', ifTrue: 'y', ifFalse: 'n' }, 'n'],
    ['jsonpath', { a: { b: 2 } }, { path: 'a.b' }, 2],
    ['regex_extract', 'RA-2026007', { pattern: 'RA-(\\d+)', group: 1 }, '2026007'], ['regex_extract', 'none', { pattern: 'RA-(\\d+)', group: 1, default: '' }, ''],
    ['to_json', { a: 1 }, undefined, '{"a":1}'], ['from_json', '{"a":1}', undefined, { a: 1 }], ['from_json', '{bad', undefined, '{bad'],
  ];
  it.each(cases)('%s', (name, value, args, expected) => {
    expect(applyTransform(name, value, args)).toEqual(expected);
  });
  it('rejects unknown transforms and lists the registry', () => {
    expect(() => applyTransform('nope', 1)).toThrow(IntegrationsError);
    expect(Object.keys(TRANSFORMS)).toContain('regex_extract');
  });
});

describe('applyMapping', () => {
  const data = { current: { temp_c: '21.5', condition: { text: 'Sunny' } }, results: [{ lat: 30.27, lon: -97.74 }] };
  it('maps sources to nested targets with transforms', () => {
    expect(applyMapping(data, [
      { source: 'current.temp_c', target: 'weather.tempC', transform: 'to_number' },
      { source: 'current.condition.text', target: 'weather.condition', transform: 'lowercase' },
      { source: 'results.0.lat', target: 'lat' },
      { source: 'missing', target: 'gone' },
    ])).toEqual({ weather: { tempC: 21.5, condition: 'sunny' }, lat: 30.27 });
  });
  it('returns the data itself for an empty mapping', () => {
    expect(applyMapping(data, [])).toEqual(data);
    expect(applyMapping('plain', [])).toEqual({ value: 'plain' });
  });
});
