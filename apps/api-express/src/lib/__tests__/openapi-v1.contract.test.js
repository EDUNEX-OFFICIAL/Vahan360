"use strict";

/**
 * Contract tests: Express v1 stable routes vs the shipped OpenAPI spec.
 *
 * These are static (no HTTP server needed) — they validate that:
 *   - every documented path + method has a meaningful response schema
 *   - required schema shapes align with what the route implementations emit
 *   - the spec can be JSON-roundtripped without loss (no circular refs)
 *
 * Add a test here whenever a new v1 route or schema field is shipped.
 */

const { SPEC } = require("../openapi");
const { SCRAPE_JOB_KINDS } = require("../jobKinds");

// ─── helpers ─────────────────────────────────────────────────────────────────

function resolveRef(ref) {
  const parts = ref.replace(/^#\//, "").split("/");
  let node = SPEC;
  for (const p of parts) {
    node = node[p];
    if (node === undefined)
      throw new Error(`$ref '${ref}' not resolvable in SPEC`);
  }
  return node;
}

function schemaOf(responseObj, statusCode = "200") {
  const r = responseObj[statusCode];
  if (!r) return null;
  const content = r.content?.["application/json"];
  if (!content) return null;
  if (content.schema?.$ref) return resolveRef(content.schema.$ref);
  return content.schema ?? null;
}

// ─── meta ────────────────────────────────────────────────────────────────────

describe("OpenAPI SPEC meta", () => {
  it("roundtrips as valid JSON without error", () => {
    const json = JSON.stringify(SPEC);
    const parsed = JSON.parse(json);
    expect(parsed.openapi).toBe("3.0.3");
    expect(parsed.info.title).toBeTruthy();
  });

  it("declares cookieAuth and bearerAuth security schemes", () => {
    const schemes = SPEC.components.securitySchemes;
    expect(schemes.cookieAuth).toBeDefined();
    expect(schemes.bearerAuth).toBeDefined();
  });

  it("lists all expected tags", () => {
    const names = SPEC.tags.map((t) => t.name);
    const required = ["auth", "scrape-jobs", "queues", "workers", "admin", "vehicle", "khanan", "health"];
    for (const tag of required) {
      expect(names).toContain(tag);
    }
  });
});

// ─── health ──────────────────────────────────────────────────────────────────

describe("Contract: /health", () => {
  it("GET /health → HealthResponse schema with all emitted fields", () => {
    const get = SPEC.paths["/health"]?.get;
    expect(get).toBeDefined();
    const schema = schemaOf(get.responses);
    expect(schema).toBeTruthy();
    const props = schema.properties;
    expect(props.status).toBeDefined();
    expect(props.service).toBeDefined();
    expect(props.ts).toBeDefined();
    expect(props.contractScrapeJobKindCount).toBeDefined();
    expect(props.metricsEnabled).toBeDefined();
    expect(props.checks.properties.redis).toBeDefined();
    expect(props.checks.properties.queue).toBeDefined();
    expect(props.checks.properties.worker).toBeDefined();
  });

  it("GET /api/health/pg → { ok, database, userCount }", () => {
    const get = SPEC.paths["/api/health/pg"]?.get;
    expect(get).toBeDefined();
    const schema = schemaOf(get.responses);
    expect(schema.properties.ok).toBeDefined();
    expect(schema.properties.database).toBeDefined();
    expect(schema.properties.userCount).toBeDefined();
  });
});

// ─── auth ────────────────────────────────────────────────────────────────────

describe("Contract: /api/auth/*", () => {
  it("POST /api/auth/login → AuthLoginResponse with user.roles array", () => {
    const post = SPEC.paths["/api/auth/login"]?.post;
    expect(post).toBeDefined();
    expect(post.security).toEqual([]);
    const schema = schemaOf(post.responses);
    expect(schema).toBeTruthy();
    const props = schema.properties;
    expect(props.token).toBeDefined();
    expect(props.user.properties.roles.type).toBe("array");
  });

  it("POST /api/auth/login requestBody requires username + password", () => {
    const body = SPEC.paths["/api/auth/login"]?.post.requestBody;
    const schema = body.content["application/json"].schema;
    const resolved = schema.$ref ? resolveRef(schema.$ref) : schema;
    expect(resolved.required).toContain("username");
    expect(resolved.required).toContain("password");
  });

  it("POST /api/auth/refresh → 401 on invalid token", () => {
    const post = SPEC.paths["/api/auth/refresh"]?.post;
    expect(post.responses["401"]).toBeDefined();
  });

  it("POST /api/auth/logout is documented", () => {
    expect(SPEC.paths["/api/auth/logout"]?.post).toBeDefined();
  });

  it("POST /api/auth/register-user requires ADMIN (403 response documented)", () => {
    const post = SPEC.paths["/api/auth/register-user"]?.post;
    expect(post).toBeDefined();
    expect(post.responses["403"]).toBeDefined();
    const body = post.requestBody.content["application/json"].schema;
    expect(body.required).toContain("username");
    expect(body.required).toContain("password");
  });
});

// ─── scrape-jobs ─────────────────────────────────────────────────────────────

describe("Contract: /api/v1/scrape-jobs", () => {
  it("ScrapeJobKind enum matches SCRAPE_JOB_KINDS runtime constant", () => {
    const enums = SPEC.components.schemas.ScrapeJobKind.enum;
    expect([...enums].sort()).toEqual([...SCRAPE_JOB_KINDS].sort());
  });

  it("POST /api/v1/scrape-jobs → 202 ScrapeJobEnqueueResponse with jobId + kind", () => {
    const post = SPEC.paths["/api/v1/scrape-jobs"]?.post;
    expect(post).toBeDefined();
    const schema = schemaOf(post.responses, "202");
    const resolved = schema.$ref ? resolveRef(schema.$ref) : schema;
    expect(resolved.properties.jobId).toBeDefined();
    expect(resolved.properties.kind).toBeDefined();
    expect(resolved.properties.status).toBeDefined();
  });

  it("POST /api/v1/scrape-jobs → 429 rate limit documented", () => {
    expect(SPEC.paths["/api/v1/scrape-jobs"]?.post.responses["429"]).toBeDefined();
  });

  it("GET /api/v1/scrape-jobs → items array + meta shape", () => {
    const get = SPEC.paths["/api/v1/scrape-jobs"]?.get;
    const schema = schemaOf(get.responses);
    expect(schema.properties.rows.type).toBe("array");
    expect(schema.properties.meta.properties.asOf).toBeDefined();
  });

  it("GET /api/v1/scrape-jobs/{jobId} → ScrapeJobStatusResponse with progress", () => {
    const get = SPEC.paths["/api/v1/scrape-jobs/{jobId}"]?.get;
    expect(get).toBeDefined();
    const schema = schemaOf(get.responses);
    const resolved = schema.$ref ? resolveRef(schema.$ref) : schema;
    expect(resolved.properties.progress).toBeDefined();
    expect(resolved.properties.status.enum).toContain("queued");
    expect(resolved.properties.status.enum).toContain("completed");
    expect(resolved.properties.status.enum).toContain("dlq");
  });

  it("GET /api/v1/scrape-jobs/{jobId}/stream → text/event-stream 200", () => {
    const get = SPEC.paths["/api/v1/scrape-jobs/{jobId}/stream"]?.get;
    expect(get).toBeDefined();
    expect(get.responses["200"].content["text/event-stream"]).toBeDefined();
  });

  it("ScrapeJobEnqueueRequest requires kind field", () => {
    const schema = SPEC.components.schemas.ScrapeJobEnqueueRequest;
    expect(schema.required).toContain("kind");
  });
});

// ─── queues + workers ─────────────────────────────────────────────────────────

describe("Contract: queues + workers", () => {
  it("GET /api/v1/queues/metrics → items + latestByQueue shapes", () => {
    const get = SPEC.paths["/api/v1/queues/metrics"]?.get;
    expect(get).toBeDefined();
    const schema = schemaOf(get.responses);
    const resolved = schema.$ref ? resolveRef(schema.$ref) : schema;
    expect(resolved.properties.items).toBeDefined();
    expect(resolved.properties.latestByQueue).toBeDefined();
  });

  it("QueueSample schema has all BullMQ counter fields", () => {
    const qs = SPEC.components.schemas.QueueSample;
    ["waiting", "active", "completed", "failed", "delayed", "prioritized"].forEach((f) => {
      expect(qs.properties[f]).toBeDefined();
    });
  });

  it("GET /api/v1/workers → workers array of WorkerStatusRow", () => {
    const get = SPEC.paths["/api/v1/workers"]?.get;
    expect(get).toBeDefined();
    const schema = schemaOf(get.responses);
    expect(schema.properties.workers.type).toBe("array");
  });

  it("WorkerStatusRow has status enum with idle/busy/draining/offline", () => {
    const ws = SPEC.components.schemas.WorkerStatusRow;
    expect(ws.properties.status.enum).toEqual(["idle", "busy", "draining", "offline"]);
  });
});

// ─── admin DLQ replay ────────────────────────────────────────────────────────

describe("Contract: admin DLQ replay", () => {
  it("POST /api/v1/admin/queues/retry-replay → 403 when role insufficient", () => {
    const post = SPEC.paths["/api/v1/admin/queues/retry-replay"]?.post;
    expect(post).toBeDefined();
    expect(post.responses["403"]).toBeDefined();
    expect(post.tags).toContain("admin");
  });

  it("retry-replay documents X-Admin-Token header", () => {
    const params = SPEC.paths["/api/v1/admin/queues/retry-replay"]?.post.parameters;
    const header = params?.find((p) => p.name === "X-Admin-Token");
    expect(header).toBeDefined();
    expect(header.in).toBe("header");
  });
});

// ─── vehicle routes ──────────────────────────────────────────────────────────

describe("Contract: /api/vehicle/*", () => {
  it("GET /api/vehicle/trip-summary documents pagination params + filter params", () => {
    const get = SPEC.paths["/api/vehicle/trip-summary"]?.get;
    expect(get).toBeDefined();
    const paramNames = get.parameters.map((p) => p.name);
    expect(paramNames).toContain("page");
    expect(paramNames).toContain("limit");
    expect(paramNames).toContain("vehicleRegNo");
    expect(paramNames).toContain("status");
  });

  it("POST /api/vehicle/trip-summary request body includes full field inventory", () => {
    const post = SPEC.paths["/api/vehicle/trip-summary"]?.post;
    expect(post).toBeDefined();
    const schema = post.requestBody.content["application/json"].schema;
    expect(schema.required).toContain("vehicleRegNo");
    const fields = Object.keys(schema.properties);
    expect(fields).toContain("totalTrips");
    expect(fields).toContain("insuranceDueDate");
    expect(fields).toContain("permitValidUpto");
    expect(fields).toContain("customerType");
    expect(fields).toContain("assignedExecutive");
    expect(fields).toContain("gstin");
  });

  it("GET /api/vehicle/trip-summary/{vehicleRegNo} documents 404", () => {
    const get = SPEC.paths["/api/vehicle/trip-summary/{vehicleRegNo}"]?.get;
    expect(get?.responses["404"]).toBeDefined();
  });

  it("GET /api/vehicle/stats is documented", () => {
    expect(SPEC.paths["/api/vehicle/stats"]?.get).toBeDefined();
  });

  it("GET /api/vehicle/owners → { owners: string[] }", () => {
    const get = SPEC.paths["/api/vehicle/owners"]?.get;
    expect(get).toBeDefined();
    const schema = schemaOf(get.responses);
    expect(schema.properties.owners.type).toBe("array");
  });

  it("POST /api/vehicle/sync → 200 sync summary", () => {
    const post = SPEC.paths["/api/vehicle/sync"]?.post;
    expect(post).toBeDefined();
    expect(post.responses["200"]).toBeDefined();
  });
});

// ─── khanan routes ───────────────────────────────────────────────────────────

describe("Contract: /api/khanan/*", () => {
  it("GET /api/khanan/data documents all filter params + pagination response shape", () => {
    const get = SPEC.paths["/api/khanan/data"]?.get;
    expect(get).toBeDefined();
    const paramNames = get.parameters.map((p) => p.name);
    expect(paramNames).toContain("district");
    expect(paramNames).toContain("fromDate");
    expect(paramNames).toContain("toDate");
    expect(paramNames).toContain("mineralName");
    expect(paramNames).toContain("vehicleRegNo");
    expect(paramNames).toContain("page");
    expect(paramNames).toContain("limit");
    const schema = schemaOf(get.responses);
    expect(schema.properties.data.type).toBe("array");
    expect(schema.properties.pagination).toBeDefined();
  });

  it("GET /api/khanan/stats is documented with date filter params", () => {
    const get = SPEC.paths["/api/khanan/stats"]?.get;
    expect(get).toBeDefined();
    const paramNames = get.parameters.map((p) => p.name);
    expect(paramNames).toContain("fromDate");
    expect(paramNames).toContain("toDate");
    const schema = schemaOf(get.responses);
    expect(schema.properties.totalRecords).toBeDefined();
    expect(schema.properties.totalQuantity).toBeDefined();
  });

  it("GET /api/khanan/districts → { districts: string[] }", () => {
    const get = SPEC.paths["/api/khanan/districts"]?.get;
    expect(get).toBeDefined();
    const schema = schemaOf(get.responses);
    expect(schema.properties.districts.type).toBe("array");
  });

  it("GET /api/khanan/minerals → { minerals: string[] }", () => {
    const get = SPEC.paths["/api/khanan/minerals"]?.get;
    expect(get).toBeDefined();
    const schema = schemaOf(get.responses);
    expect(schema.properties.minerals.type).toBe("array");
  });
});
