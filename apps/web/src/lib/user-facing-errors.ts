/** Structured details for support / devtools only — never render in UI. */
export type RequestDiagnostics = {
  status?: number;
  requestId?: string;
  traceId?: string;
  path?: string;
  body?: unknown;
};

function bodySnippet(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  try {
    const s = typeof body === 'string' ? body : JSON.stringify(body);
    return s.length > 500 ? `${s.slice(0, 500)}…` : s;
  } catch {
    return String(body);
  }
}

export function logRequestDiagnostics(details: RequestDiagnostics, message = 'API request failed'): void {
  if (typeof console === 'undefined' || typeof console.error !== 'function') return;
  const { body, ...rest } = details;
  console.error(message, {
    ...rest,
    bodySnippet: bodySnippet(body),
  });
}

function serverMessageFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const o = body as Record<string, unknown>;
  const err = o.error;
  const msg = o.message;
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (typeof msg === 'string' && msg.trim()) return msg.trim();
  return undefined;
}

/** Short, non-technical message for banners and alerts. Never include status codes here. */
export function userFacingHttpError(status: number, body: unknown): string {
  if (status === 401) {
    return 'Pehle sign in karein / Please sign in first.';
  }
  if (status === 403) {
    return 'Is action ki permission nahi hai / You do not have permission for this.';
  }
  if (status === 404) {
    return 'Ye data ab maujood nahi / This was not found.';
  }
  if (status === 429) {
    return 'Bahut zyada requests — thodi der baad try karein / Too many requests — try again in a moment.';
  }
  if (status === 502 || status === 503 || status === 504 || (status >= 500 && status < 600)) {
    return 'Server abhi busy hai — baad mein try karein / Service is busy — please try again shortly.';
  }
  const fromServer = serverMessageFromBody(body);
  if (fromServer) {
    const lower = fromServer.toLowerCase();
    if (
      lower.includes('http') ||
      lower.includes('requestid') ||
      lower.includes('traceid') ||
      lower.includes('econnrefused') ||
      lower.includes('fetch failed') ||
      lower.includes('nested') ||
      /\b\d{3}\b/.test(fromServer)
    ) {
      return 'Kuch galat ho gaya — dubara try karein / Something went wrong — please try again.';
    }
    if (fromServer.length > 200) {
      return 'Kuch galat ho gaya — dubara try karein / Something went wrong — please try again.';
    }
    return fromServer;
  }
  return 'Kuch galat ho gaya — dubara try karein / Something went wrong — please try again.';
}

export function networkErrorMessage(): string {
  return 'Network issue — check your connection and try again / Network issue — check connection and try again.';
}

/** Log diagnostics (console only), then return a user-safe banner message. */
export function logAndUserFacingHttpError(res: Response, data: unknown, path?: string): string {
  const bodyObj = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const headerRid = res.headers.get('x-request-id')?.trim() || undefined;
  const bodyRid = typeof bodyObj.requestId === 'string' ? bodyObj.requestId : undefined;
  const bodyTrace = typeof bodyObj.traceId === 'string' ? bodyObj.traceId : undefined;
  logRequestDiagnostics(
    {
      status: res.status,
      requestId: bodyRid || headerRid,
      traceId: bodyTrace,
      path,
      body: data,
    },
    'HTTP error response',
  );
  return userFacingHttpError(res.status, data);
}
