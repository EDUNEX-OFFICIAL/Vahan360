"use strict";

const { SPEC } = require("../openapi");
const { SCRAPE_JOB_KINDS } = require("../jobKinds");

describe("Express OpenAPI ↔ runtime contract", () => {
  it("documents /health with HealthResponse fields emitted by app.js", () => {
    const get = SPEC.paths["/health"]?.get;
    expect(get).toBeDefined();
    const ok = get.responses["200"].content["application/json"].schema;
    expect(ok.$ref).toBe("#/components/schemas/HealthResponse");
    const props = SPEC.components.schemas.HealthResponse.properties;
    expect(props.status).toBeDefined();
    expect(props.service).toBeDefined();
    expect(props.ts).toBeDefined();
    expect(props.contractScrapeJobKindCount).toBeDefined();
    expect(props.metricsEnabled).toBeDefined();
    expect(props.checks).toBeDefined();
  });

  it("keeps ScrapeJobKind enum aligned with SCRAPE_JOB_KINDS", () => {
    const enums = SPEC.components.schemas.ScrapeJobKind.enum;
    expect(Array.isArray(enums)).toBe(true);
    expect(enums.length).toBe(SCRAPE_JOB_KINDS.length);
    const a = [...enums].sort();
    const b = [...SCRAPE_JOB_KINDS].sort();
    expect(a).toEqual(b);
  });
});
