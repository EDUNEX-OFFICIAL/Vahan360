export interface SelectorFieldConfig {
  /** Field key in the parser/extractor surface (e.g. `dateInput`). */
  fieldKey: string;
  /** Ordered highest→lowest priority selectors. */
  selectors: string[];
  /** Optional secondary selectors for safe fallback. */
  fallbackSelectors?: string[];
  /** Critical fields participate in validation health checks. */
  critical?: boolean;
}

export interface SelectorPageConfig {
  pageKey: string;
  fields: Record<string, SelectorFieldConfig>;
}

/**
 * Shape of a portal selector registry as authored under `portals/*.yaml`.
 * `version` + `lastUpdated` are logged on every health event to tie regressions
 * to a specific selector contract revision.
 */
export interface SelectorRegistry {
  portalId: string;
  version: string;
  lastUpdated: string;
  baseUrl?: string;
  description?: string;
  pages: Record<string, SelectorPageConfig>;
}

export type SelectorProbeOutcome =
  | "matched_primary"
  | "matched_fallback"
  | "missing"
  | "error";

export interface SelectorProbe {
  fieldKey: string;
  matchedSelector?: string;
  matchedSource?: "primary" | "fallback";
  attemptedPrimary: number;
  attemptedFallback: number;
  outcome: SelectorProbeOutcome;
}

export interface SelectorFieldValidation {
  pageKey: string;
  fieldKey: string;
  critical: boolean;
  ok: boolean;
  source?: "primary" | "fallback";
}

export interface SelectorValidationResult {
  ok: boolean;
  portalId: string;
  version: string;
  lastUpdated: string;
  pageKey: string;
  missingCritical: string[];
  fallbackHits: string[];
  matched: string[];
  probes: SelectorProbe[];
  fields: SelectorFieldValidation[];
}

export interface PortalParserInput {
  pageKey: string;
  timeoutMs: number;
}

export interface SelectorResolver {
  exists(selector: string, timeoutMs: number): Promise<boolean>;
}

export interface PortalParser {
  probe(input: PortalParserInput): Promise<SelectorValidationResult>;
}
