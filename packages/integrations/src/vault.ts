import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { nowIso, type ISODate } from '@apogee/kernel';
import { IntegrationsError } from './errors';
import { findVaultRefs } from './template';

export interface VaultEntryMeta {
  key: string;
  name?: string;
  type?: string;
  createdAt: ISODate;
  rotatedAt?: ISODate;
  expiresAt?: ISODate;
  active: boolean;
}

/** Secrets by key. Values come out only through `get`; adapters encrypt at rest with the helpers below. */
export interface VaultPort {
  /** undefined when missing, inactive, or expired. */
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, meta?: Partial<Pick<VaultEntryMeta, 'name' | 'type' | 'expiresAt'>>): Promise<VaultEntryMeta>;
  rotate(key: string, value: string): Promise<VaultEntryMeta>;
  /** Deactivates; nothing is ever hard-deleted. */
  remove(key: string): Promise<boolean>;
  /** Metadata only, never values. */
  list(): Promise<VaultEntryMeta[]>;
}

export function createInMemoryVault(opts: { now?: () => ISODate } = {}): VaultPort {
  const now = opts.now ?? nowIso;
  const entries = new Map<string, { meta: VaultEntryMeta; value: string }>();
  return {
    get(key) {
      const e = entries.get(key);
      if (!e || !e.meta.active) return Promise.resolve(undefined);
      if (e.meta.expiresAt !== undefined && e.meta.expiresAt <= now()) return Promise.resolve(undefined);
      return Promise.resolve(e.value);
    },
    set(key, value, meta = {}) {
      const existing = entries.get(key);
      const m: VaultEntryMeta = {
        key,
        ...(meta.name !== undefined ? { name: meta.name } : {}),
        ...(meta.type !== undefined ? { type: meta.type } : {}),
        ...(meta.expiresAt !== undefined ? { expiresAt: meta.expiresAt } : {}),
        createdAt: existing?.meta.createdAt ?? now(),
        ...(existing ? { rotatedAt: now() } : {}),
        active: true,
      };
      entries.set(key, { meta: m, value });
      return Promise.resolve({ ...m });
    },
    rotate(key, value) {
      const e = entries.get(key);
      if (!e) return Promise.reject(new IntegrationsError(`No vault entry ${key}`, 'VAULT_MISSING'));
      e.value = value;
      e.meta = { ...e.meta, rotatedAt: now(), active: true };
      return Promise.resolve({ ...e.meta });
    },
    remove(key) {
      const e = entries.get(key);
      if (!e) return Promise.resolve(false);
      e.meta = { ...e.meta, active: false };
      return Promise.resolve(true);
    },
    list: () => Promise.resolve([...entries.values()].map((e) => ({ ...e.meta })).sort((a, b) => a.key.localeCompare(b.key))),
  };
}

function keyBytes(key: string | Buffer): Buffer {
  const b = typeof key === 'string' ? Buffer.from(key, 'hex') : key;
  if (b.length !== 32) throw new IntegrationsError('Vault key must be 32 bytes (64 hex chars)', 'BAD_KEY');
  return b;
}

/** AES-256-GCM; output `iv:tag:ciphertext` in hex. */
export function encryptSecret(plaintext: string, key: string | Buffer): string {
  const k = keyBytes(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${data.toString('hex')}`;
}

export function decryptSecret(sealed: string, key: string | Buffer): string {
  const k = keyBytes(key);
  const [iv, tag, data] = sealed.split(':');
  if (!iv || !tag || !data) throw new IntegrationsError('Sealed secret must be iv:tag:ciphertext', 'BAD_SEALED');
  const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString('utf8');
}

/** Every `{{vault:key}}` across the templates, resolved; a missing key is an error before any request is built. */
export async function resolveVaultRefs(vault: VaultPort, templates: readonly string[]): Promise<Record<string, string>> {
  const keys = [...new Set(templates.flatMap(findVaultRefs))];
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = await vault.get(key);
    if (value === undefined) throw new IntegrationsError(`No vault entry ${key}`, 'VAULT_MISSING');
    out[key] = value;
  }
  return out;
}
