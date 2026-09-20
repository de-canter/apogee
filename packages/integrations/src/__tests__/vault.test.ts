import { isoDate } from '@apogee/kernel';
import { describe, expect, it } from 'vitest';
import { IntegrationsError } from '../errors';
import { createInMemoryVault, decryptSecret, encryptSecret, resolveVaultRefs } from '../vault';

const KEY = 'a'.repeat(64);

describe('createInMemoryVault', () => {
  it('stores, rotates, expires, deactivates, and never lists values', async () => {
    let t = 0;
    const vault = createInMemoryVault({ now: () => isoDate(`2026-09-19T12:0${t++}:00Z`) });
    const meta = await vault.set('api_key', 'demo-key-123', { name: 'Mock API key', type: 'api_key' });
    expect(meta).toMatchObject({ key: 'api_key', name: 'Mock API key', type: 'api_key', active: true, createdAt: '2026-09-19T12:00:00.000Z' });
    expect(await vault.get('api_key')).toBe('demo-key-123');
    expect(await vault.get('missing')).toBeUndefined();
    const rotated = await vault.rotate('api_key', 'demo-key-456');
    expect(rotated.rotatedAt).toBe('2026-09-19T12:01:00.000Z');
    expect(await vault.get('api_key')).toBe('demo-key-456');
    await expect(vault.rotate('nope', 'x')).rejects.toBeInstanceOf(IntegrationsError);
    await vault.set('old', 'gone', { expiresAt: isoDate('2026-09-19T12:00:30Z') });
    expect(await vault.get('old')).toBeUndefined();
    expect(await vault.remove('api_key')).toBe(true);
    expect(await vault.get('api_key')).toBeUndefined();
    const listed = await vault.list();
    expect(listed.map((m) => `${m.key}:${m.active}`)).toEqual(['api_key:false', 'old:true']);
    expect(JSON.stringify(listed)).not.toContain('demo-key');
  });
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips with AES-256-GCM and detects tampering', () => {
    const sealed = encryptSecret('demo-key-123', KEY);
    expect(sealed.split(':')).toHaveLength(3);
    expect(sealed).not.toContain('demo-key');
    expect(decryptSecret(sealed, KEY)).toBe('demo-key-123');
    expect(encryptSecret('demo-key-123', KEY)).not.toBe(sealed);
    const [iv, tag, data] = sealed.split(':');
    expect(() => decryptSecret(`${iv}:${'0'.repeat(tag!.length)}:${data}`, KEY)).toThrow();
    expect(() => encryptSecret('x', 'short')).toThrow(IntegrationsError);
  });
});

describe('resolveVaultRefs', () => {
  it('collects the keys across templates and fails on a missing one', async () => {
    const vault = createInMemoryVault();
    await vault.set('api_key', 'k1');
    await vault.set('sig', 's1');
    expect(await resolveVaultRefs(vault, ['{{vars.baseUrl}}?key={{vault:api_key}}', '{{vault:sig}} {{vault:api_key}}'])).toEqual({ api_key: 'k1', sig: 's1' });
    await expect(resolveVaultRefs(vault, ['{{vault:nope}}'])).rejects.toMatchObject({ code: 'VAULT_MISSING' });
    expect(await resolveVaultRefs(vault, ['plain'])).toEqual({});
  });
});
