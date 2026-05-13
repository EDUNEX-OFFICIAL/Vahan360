import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type {
  SelectorFieldConfig,
  SelectorFieldValidation,
  SelectorProbe,
  SelectorResolver,
  SelectorRegistry,
  SelectorValidationResult,
} from "./types";

/**
 * Resolve the on-disk `portals/` directory.
 *
 * Allow overrides through `SCRAPER_PORTALS_DIR` for tests or container builds
 * where the directory moves; default falls back to a path relative to this
 * compiled file (`dist/selectorRegistry.js` → `<pkg>/portals`).
 */
function resolvePortalsDir(): string {
  const override = process.env.SCRAPER_PORTALS_DIR?.trim();
  if (override) return path.resolve(override);
  // dist/ sits next to portals/, so walk one level up from the compiled file.
  return path.resolve(__dirname, "..", "portals");
}

const REGISTRY_CACHE = new Map<string, SelectorRegistry>();

function readRegistryFile(portalsDir: string, portalId: string): string {
  const candidates = [
    path.join(portalsDir, `${portalId}.yaml`),
    path.join(portalsDir, `${portalId}.yml`),
    path.join(portalsDir, `${portalId}.json`),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      return fs.readFileSync(file, "utf8");
    }
  }
  throw new Error(
    `No selector registry found for portal "${portalId}" under ${portalsDir}`
  );
}

function parseRegistry(raw: string, portalId: string): SelectorRegistry {
  const parsed = yaml.load(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid selector registry for "${portalId}": not an object`);
  }
  const rec = parsed as Record<string, unknown>;
  const version = rec.version;
  if (typeof version !== "string" || version.trim().length === 0) {
    throw new Error(`Selector registry "${portalId}" missing string "version"`);
  }
  const lastUpdated = rec.lastUpdated;
  if (typeof lastUpdated !== "string" || lastUpdated.trim().length === 0) {
    throw new Error(`Selector registry "${portalId}" missing string "lastUpdated"`);
  }

  const pages = normalizePages(rec, portalId);
  return {
    portalId: typeof rec.portalId === "string" ? rec.portalId : portalId,
    version,
    lastUpdated,
    baseUrl: typeof rec.baseUrl === "string" ? rec.baseUrl : undefined,
    description:
      typeof rec.description === "string" ? rec.description : undefined,
    pages,
  };
}

/**
 * Load (and cache) a selector registry by portal id. Set `force` to bypass the
 * in-memory cache when reloading from disk in dev.
 */
export function getSelectorRegistry(
  portalId: string,
  options: { force?: boolean } = {}
): SelectorRegistry {
  if (!portalId || typeof portalId !== "string") {
    throw new Error("getSelectorRegistry: portalId required");
  }
  if (!options.force) {
    const cached = REGISTRY_CACHE.get(portalId);
    if (cached) return cached;
  }
  const raw = readRegistryFile(resolvePortalsDir(), portalId);
  const registry = parseRegistry(raw, portalId);
  REGISTRY_CACHE.set(portalId, registry);
  return registry;
}

/**
 * Stub: verify a probed DOM snapshot exposes every required selector key.
 * Returns a structured result the caller can persist in a `job_events` row.
 */
function normalizePages(
  rec: Record<string, unknown>,
  portalId: string
): Record<string, { pageKey: string; fields: Record<string, SelectorFieldConfig> }> {
  const pagesRaw = rec.pages;
  if (pagesRaw && typeof pagesRaw === "object" && !Array.isArray(pagesRaw)) {
    const out: Record<
      string,
      { pageKey: string; fields: Record<string, SelectorFieldConfig> }
    > = {};
    for (const [pageKey, pageRaw] of Object.entries(
      pagesRaw as Record<string, unknown>
    )) {
      if (!pageRaw || typeof pageRaw !== "object" || Array.isArray(pageRaw)) {
        throw new Error(
          `Selector registry "${portalId}" page "${pageKey}" must be an object`
        );
      }
      const fieldsRaw = (pageRaw as Record<string, unknown>).fields;
      if (!fieldsRaw || typeof fieldsRaw !== "object" || Array.isArray(fieldsRaw)) {
        throw new Error(
          `Selector registry "${portalId}" page "${pageKey}" missing fields map`
        );
      }
      const fields: Record<string, SelectorFieldConfig> = {};
      for (const [fieldKey, fieldRaw] of Object.entries(
        fieldsRaw as Record<string, unknown>
      )) {
        if (!fieldRaw || typeof fieldRaw !== "object" || Array.isArray(fieldRaw)) {
          throw new Error(
            `Selector registry "${portalId}" field "${pageKey}.${fieldKey}" must be an object`
          );
        }
        const selectors = normalizeSelectorArray(
          (fieldRaw as Record<string, unknown>).selectors,
          `${portalId}:${pageKey}.${fieldKey}.selectors`
        );
        if (selectors.length === 0) {
          throw new Error(
            `Selector registry "${portalId}" field "${pageKey}.${fieldKey}" requires selectors`
          );
        }
        const fallbackSelectors = normalizeOptionalSelectorArray(
          (fieldRaw as Record<string, unknown>).fallbackSelectors,
          `${portalId}:${pageKey}.${fieldKey}.fallbackSelectors`
        );
        fields[fieldKey] = {
          fieldKey,
          selectors,
          fallbackSelectors,
          critical:
            typeof (fieldRaw as Record<string, unknown>).critical === "boolean"
              ? Boolean((fieldRaw as Record<string, unknown>).critical)
              : false,
        };
      }
      out[pageKey] = { pageKey, fields };
    }
    if (Object.keys(out).length === 0) {
      throw new Error(`Selector registry "${portalId}" must define at least one page`);
    }
    return out;
  }

  // Backward compatibility for legacy shape.
  const requiredSelectors = rec.requiredSelectors;
  const selectors = rec.selectors;
  if (
    !Array.isArray(requiredSelectors) ||
    !requiredSelectors.every((k) => typeof k === "string")
  ) {
    throw new Error(
      `Selector registry "${portalId}" must define requiredSelectors: string[]`
    );
  }
  if (
    !selectors ||
    typeof selectors !== "object" ||
    Array.isArray(selectors) ||
    Object.values(selectors as Record<string, unknown>).some(
      (v) => typeof v !== "string"
    )
  ) {
    throw new Error(
      `Selector registry "${portalId}" must define selectors: Record<string,string>`
    );
  }
  const fields: Record<string, SelectorFieldConfig> = {};
  for (const [fieldKey, selector] of Object.entries(
    selectors as Record<string, string>
  )) {
    fields[fieldKey] = {
      fieldKey,
      selectors: [selector],
      critical: requiredSelectors.includes(fieldKey),
    };
  }
  return { default: { pageKey: "default", fields } };
}

function normalizeSelectorArray(raw: unknown, label: string): string[] {
  if (!Array.isArray(raw)) {
    throw new Error(`${label} must be string[]`);
  }
  return raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function normalizeOptionalSelectorArray(raw: unknown, label: string): string[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(`${label} must be string[] when provided`);
  }
  const arr = raw.filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0
  );
  return arr.length > 0 ? arr : undefined;
}

function createValidationResultBase(
  registry: SelectorRegistry,
  pageKey: string
): Omit<SelectorValidationResult, "ok"> {
  return {
    portalId: registry.portalId,
    version: registry.version,
    lastUpdated: registry.lastUpdated,
    pageKey,
    missingCritical: [],
    fallbackHits: [],
    matched: [],
    probes: [],
    fields: [],
  };
}

export async function validateRequiredSelectors(
  registryOrPortalId: SelectorRegistry | string,
  resolver: SelectorResolver,
  options: { pageKey?: string; timeoutMs?: number } = {}
): Promise<SelectorValidationResult> {
  const registry =
    typeof registryOrPortalId === "string"
      ? getSelectorRegistry(registryOrPortalId)
      : registryOrPortalId;

  const pageKey = options.pageKey || "default";
  const page = registry.pages[pageKey];
  if (!page) {
    throw new Error(
      `Selector registry "${registry.portalId}" missing page "${pageKey}"`
    );
  }

  const result = createValidationResultBase(registry, pageKey);
  const timeoutMs =
    typeof options.timeoutMs === "number" && options.timeoutMs > 0
      ? options.timeoutMs
      : 2_000;

  for (const [fieldKey, field] of Object.entries(page.fields)) {
    const probe: SelectorProbe = {
      fieldKey,
      attemptedPrimary: 0,
      attemptedFallback: 0,
      outcome: "missing",
    };
    let fieldOk = false;
    let source: "primary" | "fallback" | undefined;

    for (const selector of field.selectors) {
      probe.attemptedPrimary += 1;
      try {
        if (await resolver.exists(selector, timeoutMs)) {
          probe.matchedSelector = selector;
          probe.matchedSource = "primary";
          probe.outcome = "matched_primary";
          fieldOk = true;
          source = "primary";
          break;
        }
      } catch {
        probe.outcome = "error";
      }
    }

    if (!fieldOk && Array.isArray(field.fallbackSelectors)) {
      for (const fallback of field.fallbackSelectors) {
        probe.attemptedFallback += 1;
        try {
          if (await resolver.exists(fallback, timeoutMs)) {
            probe.matchedSelector = fallback;
            probe.matchedSource = "fallback";
            probe.outcome = "matched_fallback";
            fieldOk = true;
            source = "fallback";
            break;
          }
        } catch {
          probe.outcome = "error";
        }
      }
    }

    const critical = Boolean(field.critical);
    if (!fieldOk && critical) {
      result.missingCritical.push(fieldKey);
    }
    if (fieldOk) {
      result.matched.push(fieldKey);
    }
    if (source === "fallback") {
      result.fallbackHits.push(fieldKey);
    }
    const fieldValidation: SelectorFieldValidation = {
      pageKey,
      fieldKey,
      critical,
      ok: fieldOk,
      source,
    };
    result.probes.push(probe);
    result.fields.push(fieldValidation);
  }

  return {
    ...result,
    ok: result.missingCritical.length === 0,
  };
}

/** Test/build helper: clear the in-memory cache. */
export function _resetSelectorRegistryCacheForTests(): void {
  REGISTRY_CACHE.clear();
}
