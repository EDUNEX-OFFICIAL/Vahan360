import type { Request } from 'express';

export const ACCESS_COOKIE_NAME = 'spybot_access';

export function extractBearerToken(req: Request): string | undefined {
  const raw = req.headers.authorization;
  if (typeof raw !== 'string') return undefined;
  const h = raw.trim();
  if (!h.toLowerCase().startsWith('bearer ')) return undefined;
  const t = h.slice(7).trim();
  return t.length ? t : undefined;
}

export function extractCookie(req: Request, name: string): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) {
    return undefined;
  }
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of cookieHeader.split(';')) {
    const p = part.trim();
    if (!p.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(p.slice(prefix.length));
    } catch {
      return p.slice(prefix.length);
    }
  }
  return undefined;
}

export type ResolvedAccessToken =
  | { status: 'bearer_deprecated' }
  | { status: 'missing' }
  | { status: 'ok'; token: string };

/**
 * Bearer only when `allowBearer` is true; otherwise `spybot_access` cookie only.
 */
export function accessTokenFromRequest(
  req: Request,
  allowBearer: boolean,
): ResolvedAccessToken {
  const bearer = extractBearerToken(req);
  if (bearer && !allowBearer) {
    return { status: 'bearer_deprecated' };
  }
  const cookie = extractCookie(req, ACCESS_COOKIE_NAME) ?? '';
  const token = allowBearer && bearer ? bearer : cookie;
  if (!token) {
    return { status: 'missing' };
  }
  return { status: 'ok', token };
}
