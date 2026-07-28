import type { Env } from './types';

const SESSION_COOKIE = '__Host-shiraz_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const TOKEN_BYTES = 32;

type WorkersSubtleCrypto = SubtleCrypto & {
  timingSafeEqual(
    first: ArrayBuffer | ArrayBufferView,
    second: ArrayBuffer | ArrayBufferView
  ): boolean;
};

function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie') || '';
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === name) return rawValue.join('=') || null;
  }
  return null;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sessionId(token: string): Promise<string> {
  return bytesToHex(await sha256(token));
}

export async function securelyMatchesPin(submittedPin: string, configuredPin: string): Promise<boolean> {
  const [submittedDigest, configuredDigest] = await Promise.all([
    sha256(submittedPin),
    sha256(configuredPin)
  ]);
  return (crypto.subtle as WorkersSubtleCrypto)
    .timingSafeEqual(submittedDigest, configuredDigest);
}

export function createSessionCookie(token: string): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${SESSION_TTL_SECONDS}`
  ].join('; ');
}

export function clearSessionCookie(): string {
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Max-Age=0'
  ].join('; ');
}

export async function clearExpiredAuthSessions(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?')
    .bind(new Date().toISOString())
    .run();
}

export async function createAuthSession(env: Env): Promise<string> {
  await clearExpiredAuthSessions(env);

  const randomBytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(randomBytes);
  const token = encodeBase64Url(randomBytes);
  const id = await sessionId(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

  await env.DB.prepare(`
    INSERT INTO auth_sessions (id, created_at, expires_at)
    VALUES (?, ?, ?)
  `).bind(id, now.toISOString(), expiresAt.toISOString()).run();

  return token;
}

export async function hasValidAuthSession(request: Request, env: Env): Promise<boolean> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;

  const record = await env.DB.prepare(`
    SELECT id
    FROM auth_sessions
    WHERE id = ? AND expires_at > ?
    LIMIT 1
  `).bind(await sessionId(token), new Date().toISOString()).first();

  return Boolean(record);
}

export async function deleteAuthSession(request: Request, env: Env): Promise<void> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;

  await env.DB.prepare('DELETE FROM auth_sessions WHERE id = ?')
    .bind(await sessionId(token))
    .run();
}
