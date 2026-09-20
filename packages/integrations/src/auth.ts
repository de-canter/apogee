import { createHmac, timingSafeEqual } from 'node:crypto';
import { IntegrationsError } from './errors';
import { AUTH_METHODS, type AuthMethodName } from './pattern';

export interface OutboundRequest { method: string; url: string; headers: Record<string, string>; body?: string }
export interface InboundRequest { headers: Record<string, string>; rawBody: string }
export interface AuthDeps { fetch: typeof fetch; now: () => number }
export interface VerifyResult { valid: boolean; identity?: string; error?: string }

/** One way to prove who is calling: applied to outbound requests, checked on inbound ones. */
export interface AuthMethod {
  name: AuthMethodName;
  inject(req: OutboundRequest, secret: string, config: Record<string, unknown>, deps: AuthDeps): Promise<OutboundRequest>;
  verify(req: InboundRequest, secret: string, config: Record<string, unknown>, deps: AuthDeps): Promise<VerifyResult>;
}

const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v !== '' ? v : fallback);
const digestEncoding = (v: unknown): 'hex' | 'base64' => (v === 'base64' ? 'base64' : 'hex');
const header = (headers: Record<string, string>, name: string): string | undefined => {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === lower) return v;
  return undefined;
};
const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const withQuery = (url: string, name: string, value: string): string => {
  const u = new URL(url);
  u.searchParams.set(name, value);
  return u.toString();
};
const bearer = (headers: Record<string, string>): string | undefined => {
  const h = header(headers, 'authorization');
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
};

const apiKey: AuthMethod = {
  name: 'api_key',
  inject(req, secret, config) {
    const value = `${str(config['prefix'], '')}${secret}`;
    const name = str(config['name'], 'X-API-Key');
    if (config['placement'] === 'query') return Promise.resolve({ ...req, url: withQuery(req.url, name, value) });
    return Promise.resolve({ ...req, headers: { ...req.headers, [name]: value } });
  },
  verify(req, secret, config) {
    const name = str(config['name'], 'X-API-Key');
    const expected = `${str(config['prefix'], '')}${secret}`;
    const presented = config['placement'] === 'query' ? undefined : header(req.headers, name);
    if (presented === undefined) return Promise.resolve({ valid: false, error: `API key header ${name} missing` });
    return Promise.resolve(safeEqual(presented, expected) ? { valid: true } : { valid: false, error: 'API key does not match' });
  },
};

const basic: AuthMethod = {
  name: 'basic',
  inject: (req, secret) => Promise.resolve({ ...req, headers: { ...req.headers, Authorization: `Basic ${Buffer.from(secret).toString('base64')}` } }),
  verify(req, secret) {
    const h = header(req.headers, 'authorization');
    if (!h?.startsWith('Basic ')) return Promise.resolve({ valid: false, error: 'Basic credentials missing' });
    const presented = Buffer.from(h.slice(6), 'base64').toString('utf8');
    if (!safeEqual(presented, secret)) return Promise.resolve({ valid: false, error: 'Basic credentials do not match' });
    return Promise.resolve({ valid: true, identity: secret.split(':')[0] ?? secret });
  },
};

const hmac: AuthMethod = {
  name: 'hmac',
  inject(req, secret, config) {
    const sig = createHmac(str(config['algorithm'], 'sha256'), secret).update(req.body ?? '').digest(digestEncoding(config['encoding']));
    return Promise.resolve({ ...req, headers: { ...req.headers, [str(config['header'], 'X-Signature')]: `${str(config['prefix'], '')}${sig}` } });
  },
  verify(req, secret, config) {
    const presented = header(req.headers, str(config['header'], 'X-Signature'));
    if (presented === undefined) return Promise.resolve({ valid: false, error: 'HMAC signature header missing' });
    const prefix = str(config['prefix'], '');
    const raw = presented.startsWith(prefix) ? presented.slice(prefix.length) : presented;
    const expected = createHmac(str(config['algorithm'], 'sha256'), secret).update(req.rawBody).digest(digestEncoding(config['encoding']));
    return Promise.resolve(safeEqual(raw, expected) ? { valid: true } : { valid: false, error: 'HMAC signature does not match' });
  },
};

const b64url = (b: Buffer | string): string => Buffer.from(b).toString('base64url');
export interface JwtClaims { iss?: string; aud?: string; sub?: string; iat?: number; exp?: number; [k: string]: unknown }

/** HS256 compact JWT. */
export function signJwt(claims: JwtClaims, secret: string, headerOverride: Record<string, unknown> = {}): string {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', ...headerOverride }));
  const body = b64url(JSON.stringify(claims));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export function verifyJwt(token: string, secret: string, opts: { now?: () => number; issuer?: string; audience?: string } = {}): JwtClaims {
  const [head, body, sig] = token.split('.');
  if (!head || !body || !sig) throw new IntegrationsError('Malformed JWT', 'BAD_JWT');
  const h = JSON.parse(Buffer.from(head, 'base64url').toString('utf8')) as { alg?: string };
  if (h.alg !== 'HS256') throw new IntegrationsError(`Unsupported JWT algorithm ${String(h.alg)}`, 'BAD_JWT');
  const expected = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  if (!safeEqual(sig, expected)) throw new IntegrationsError('JWT signature does not match', 'BAD_JWT');
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JwtClaims;
  const now = Math.floor((opts.now ?? Date.now)() / 1000);
  if (typeof claims.exp === 'number' && claims.exp <= now) throw new IntegrationsError('JWT expired', 'BAD_JWT');
  if (opts.issuer !== undefined && claims.iss !== opts.issuer) throw new IntegrationsError('JWT issuer does not match', 'BAD_JWT');
  if (opts.audience !== undefined && claims.aud !== opts.audience) throw new IntegrationsError('JWT audience does not match', 'BAD_JWT');
  return claims;
}

const jwtBearer: AuthMethod = {
  name: 'jwt_bearer',
  inject(req, secret, config, deps) {
    const iat = Math.floor(deps.now() / 1000);
    const expiresIn = typeof config['expiresInSec'] === 'number' ? config['expiresInSec'] : 300;
    const extra = config['claims'] && typeof config['claims'] === 'object' ? (config['claims'] as Record<string, unknown>) : {};
    const claims: JwtClaims = {
      ...extra,
      ...(typeof config['issuer'] === 'string' ? { iss: config['issuer'] } : {}),
      ...(typeof config['audience'] === 'string' ? { aud: config['audience'] } : {}),
      ...(typeof config['subject'] === 'string' ? { sub: config['subject'] } : {}),
      iat,
      exp: iat + expiresIn,
    };
    return Promise.resolve({ ...req, headers: { ...req.headers, Authorization: `Bearer ${signJwt(claims, secret)}` } });
  },
  verify(req, secret, config, deps) {
    const token = bearer(req.headers);
    if (!token) return Promise.resolve({ valid: false, error: 'Bearer token missing' });
    try {
      const claims = verifyJwt(token, secret, { now: deps.now, ...(typeof config['issuer'] === 'string' ? { issuer: config['issuer'] } : {}), ...(typeof config['audience'] === 'string' ? { audience: config['audience'] } : {}) });
      const identity = claims.sub ?? claims.iss;
      return Promise.resolve({ valid: true, ...(identity !== undefined ? { identity } : {}) });
    } catch (e) {
      return Promise.resolve({ valid: false, error: e instanceof Error ? e.message : 'JWT invalid' });
    }
  },
};

interface OAuthSecret { clientId: string; clientSecret: string; tokenUrl: string; scope?: string }
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
export const OAUTH_EXPIRY_BUFFER_MS = 30_000;

function parseOAuthSecret(secret: string): OAuthSecret {
  try {
    const s = JSON.parse(secret) as Partial<OAuthSecret>;
    if (typeof s.clientId !== 'string' || typeof s.clientSecret !== 'string' || typeof s.tokenUrl !== 'string') throw new Error('fields');
    return s as OAuthSecret;
  } catch {
    throw new IntegrationsError('OAuth2 secret must be JSON with clientId, clientSecret, tokenUrl', 'BAD_OAUTH_SECRET');
  }
}

const oauth2: AuthMethod = {
  name: 'oauth2',
  async inject(req, secret, _config, deps) {
    const s = parseOAuthSecret(secret);
    const key = `${s.clientId}@${s.tokenUrl}`;
    const cached = tokenCache.get(key);
    let token = cached && cached.expiresAt > deps.now() ? cached.token : undefined;
    if (token === undefined) {
      const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: s.clientId, client_secret: s.clientSecret, ...(s.scope !== undefined ? { scope: s.scope } : {}) });
      const res = await deps.fetch(s.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
      if (!res.ok) throw new IntegrationsError(`OAuth2 token request failed with ${res.status}`, 'OAUTH_TOKEN');
      const json = (await res.json()) as { access_token?: string; expires_in?: number };
      if (typeof json.access_token !== 'string') throw new IntegrationsError('OAuth2 token response had no access_token', 'OAUTH_TOKEN');
      token = json.access_token;
      tokenCache.set(key, { token, expiresAt: deps.now() + (json.expires_in ?? 3600) * 1000 - OAUTH_EXPIRY_BUFFER_MS });
    }
    return { ...req, headers: { ...req.headers, Authorization: `Bearer ${token}` } };
  },
  async verify(req, secret, config, deps) {
    const token = bearer(req.headers);
    if (!token) return { valid: false, error: 'Bearer token missing' };
    const url = config['introspectionUrl'];
    if (typeof url !== 'string') return { valid: false, error: 'OAuth2 introspection not configured; cannot verify a bearer token' };
    const s = parseOAuthSecret(secret);
    const res = await deps.fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${s.clientId}:${s.clientSecret}`).toString('base64')}` }, body: new URLSearchParams({ token }).toString() });
    if (!res.ok) return { valid: false, error: `Introspection failed with ${res.status}` };
    const json = (await res.json()) as { active?: boolean; sub?: string };
    if (!json.active) return { valid: false, error: 'Token is not active' };
    return { valid: true, ...(typeof json.sub === 'string' ? { identity: json.sub } : {}) };
  },
};

export const AUTH: Record<AuthMethodName, AuthMethod> = { api_key: apiKey, basic, oauth2, hmac, jwt_bearer: jwtBearer };

export function getAuthMethod(name: string): AuthMethod {
  if (!(AUTH_METHODS as readonly string[]).includes(name)) throw new IntegrationsError(`Unknown auth method "${name}"`, 'UNKNOWN_AUTH_METHOD');
  return AUTH[name as AuthMethodName];
}

/** Test hook. */
export function clearTokenCache(): void {
  tokenCache.clear();
}

const SENSITIVE = ['authorization', 'x-api-key', 'x-signature', 'cookie', 'set-cookie', 'proxy-authorization'];

/** Sensitive headers keep their first six characters. */
export function maskHeaders(headers: Record<string, string>, extra: readonly string[] = []): Record<string, string> {
  const names = new Set([...SENSITIVE, ...extra.map((n) => n.toLowerCase())]);
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, names.has(k.toLowerCase()) ? `${v.slice(0, 6)}***` : v]));
}

export function redactUrl(url: string): string {
  const i = url.indexOf('?');
  return i === -1 ? url : `${url.slice(0, i)}?[redacted]`;
}
