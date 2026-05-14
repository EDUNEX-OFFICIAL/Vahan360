import { validateRequiredSelectors } from "./selectorRegistry";
import type {
  PortalParser,
  PortalParserInput,
  SelectorRegistry,
  SelectorResolver,
} from "./types";

export class RegistryBackedPortalParser implements PortalParser {
  private readonly registry: SelectorRegistry;
  private readonly resolver: SelectorResolver;

  constructor(registry: SelectorRegistry, resolver: SelectorResolver) {
    this.registry = registry;
    this.resolver = resolver;
  }

  async probe(input: PortalParserInput) {
    return validateRequiredSelectors(this.registry, this.resolver, {
      pageKey: input.pageKey,
      timeoutMs: input.timeoutMs,
    });
  }
}
