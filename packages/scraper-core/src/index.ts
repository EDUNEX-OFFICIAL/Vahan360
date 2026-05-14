export type {
  PortalParser,
  PortalParserInput,
  SelectorFieldConfig,
  SelectorFieldValidation,
  SelectorPageConfig,
  SelectorProbe,
  SelectorProbeOutcome,
  SelectorResolver,
  SelectorRegistry,
  SelectorValidationResult,
} from "./types";
export {
  _resetSelectorRegistryCacheForTests,
  getSelectorRegistry,
  validateRequiredSelectors,
} from "./selectorRegistry";
export { RegistryBackedPortalParser } from "./portalParser";
export type {
  PlaywrightSmokeInput,
  PlaywrightSmokeResult,
} from "./playwrightSmoke";
export { runPlaywrightSmoke } from "./playwrightSmoke";
export { parseStubPortalHtml } from "./parserStub";
