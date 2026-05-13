import type { Browser, BrowserContext } from "playwright-core";
import { getSelectorRegistry } from "./selectorRegistry";
import { RegistryBackedPortalParser } from "./portalParser";
import type { SelectorRegistry, SelectorValidationResult } from "./types";

export interface PlaywrightSmokeInput {
  /** URL the smoke run should navigate to. */
  url: string;
  /** Optional portal id; when supplied we run `validateRequiredSelectors`. */
  portalId?: string;
  /** Override navigation timeout (ms). Defaults to 20s. */
  timeoutMs?: number;
  /** Override navigation `waitUntil` mode. */
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  /** Registry page key (default: `default`). */
  pageKey?: string;
  /** Pre-resolved registry (skips disk read if provided). */
  registry?: SelectorRegistry;
  /** Optional pre-acquired browser context (pool-managed by caller). */
  context?: BrowserContext;
}

export interface PlaywrightSmokeResult {
  url: string;
  finalUrl: string;
  title: string;
  loadMs: number;
  registry?: { portalId: string; version: string };
  validation?: SelectorValidationResult;
}

/**
 * One-shot Playwright chromium smoke. Imports `playwright-core` lazily so the
 * module stays importable in environments where browsers aren't installed.
 *
 * Browsers must be installed out-of-band (e.g. `pnpm dlx playwright install
 * chromium`). The worker gates this entire helper behind `PLAYWRIGHT_ENABLED`
 * + `PLAYWRIGHT_SMOKE_URL` so CI stays browser-free by default.
 */
export async function runPlaywrightSmoke(
  input: PlaywrightSmokeInput
): Promise<PlaywrightSmokeResult> {
  if (!input?.url || typeof input.url !== "string") {
    throw new Error("runPlaywrightSmoke: url is required");
  }

  // Dynamic require so consumers without a browser install still build.
  const playwright: typeof import("playwright-core") = require("playwright-core");
  const timeoutMs =
    typeof input.timeoutMs === "number" && input.timeoutMs > 0
      ? input.timeoutMs
      : 20_000;
  const waitUntil = input.waitUntil || "domcontentloaded";
  const pageKey = input.pageKey || "default";

  const registry =
    input.registry ||
    (input.portalId ? getSelectorRegistry(input.portalId) : undefined);

  let browser: Browser | undefined;
  let ctx: BrowserContext | undefined;
  const externalContext = input.context;
  const startedAt = Date.now();
  try {
    if (externalContext) {
      ctx = externalContext;
    } else {
      browser = await playwright.chromium.launch({ headless: true });
      ctx = await browser.newContext();
    }
    const page = await ctx.newPage();
    const response = await page.goto(input.url, { waitUntil, timeout: timeoutMs });
    const title = (await page.title().catch(() => "")) || "";
    const finalUrl = response?.url() || page.url() || input.url;

    let validation: SelectorValidationResult | undefined;
    if (registry) {
      const parser = new RegistryBackedPortalParser(registry, {
        async exists(selector, selectorTimeoutMs) {
          const handle = await page.waitForSelector(selector, {
            state: "attached",
            timeout: Math.min(selectorTimeoutMs, timeoutMs),
          });
          if (!handle) return false;
          await handle.dispose().catch(() => undefined);
          return true;
        },
      });
      validation = await parser.probe({
        pageKey,
        timeoutMs: Math.min(2_000, timeoutMs / 4),
      });
    }

    return {
      url: input.url,
      finalUrl,
      title,
      loadMs: Date.now() - startedAt,
      registry: registry
        ? { portalId: registry.portalId, version: registry.version }
        : undefined,
      validation,
    };
  } finally {
    if (ctx && !externalContext) await ctx.close().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
  }
}
