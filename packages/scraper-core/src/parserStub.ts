/**
 * Stub HTML probe for transport/portal wiring tests — no DOM parser, only
 * cheap substring / regex checks so workers can sanity-check payloads early.
 */
export function parseStubPortalHtml(html: string): {
  ok: boolean;
  hints: string[];
} {
  const hints: string[] = [];
  const s = html.trim();

  if (!s) {
    return { ok: false, hints: ["empty-html"] };
  }

  if (/<\s*html\b/i.test(s)) {
    hints.push("has-html-root");
  }
  if (/<\s*form\b/i.test(s)) {
    hints.push("has-form");
  }

  const ok = hints.length > 0;

  return { ok, hints };
}
