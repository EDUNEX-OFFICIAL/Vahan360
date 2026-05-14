"use strict";

/**
 * Static OpenAPI 3.0.3 spec for Express v1 routes.
 *
 * Served at GET /api/docs/openapi.json when OPENAPI_ENABLED=true.
 * A Swagger UI HTML shell at GET /api/docs loads it from CDN so no extra
 * npm package is required.
 *
 * To regenerate / extend: edit SPEC below and re-deploy. All v1 stable routes
 * are documented here (stable v1 + legacy reads); v2 Nest routes have their own live Swagger (OPENAPI_ENABLED
 * on api-nest, /api/v2/docs).
 */

/** @type {import('./openapi').OpenApiSpec} */
const SPEC = {
  openapi: "3.0.3",
  info: {
    title: "Vahan360 Express v1 API",
    version: "1.0.0",
    description:
      "Control-plane API for auth, scrape-job enqueue/stream, queue metrics, " +
      "worker status, admin DLQ replay, health, legacy vehicle + khanan reads, " +
      "and optional Nest vehicle-intel delegate (`/api/vehicle/v2-intel/*`).\n\n" +
      "Auth: httpOnly cookie `spybot_access` (primary) + `X-CSRF-Token` header " +
      "on mutating routes. Bearer `Authorization` header supported when " +
      "`AUTH_ALLOW_BEARER=true` (deprecated, see SECURITY_ROADMAP_HTTPONLY.md).\n\n" +
      "v2 routes (NestJS) are proxied via `/api/v2` — see Nest Swagger at `/api/v2/docs`.",
    contact: { name: "Vahan360 Team" },
    license: { name: "MIT" },
  },
  servers: [
    { url: "/", description: "Current host (reverse-proxy / Kubernetes ingress)" },
    { url: "http://localhost:5000", description: "Local dev (default BACKEND_PORT)" },
  ],
  tags: [
    { name: "auth", description: "Authentication & session management" },
    { name: "scrape-jobs", description: "Ingest job enqueue, status, SSE stream" },
    { name: "queues", description: "Queue depth metrics" },
    { name: "workers", description: "Worker heartbeat / status" },
    { name: "admin", description: "Admin-only DLQ replay & queue management (ADMIN role)" },
    { name: "vehicle", description: "Legacy vehicle reads (public Postgres)" },
    { name: "khanan", description: "Legacy khanan reads" },
    { name: "health", description: "Service health checks" },
  ],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "spybot_access",
        description: "httpOnly access cookie set on login/refresh.",
      },
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "Deprecated — enabled only when AUTH_ALLOW_BEARER=true. Prefer cookie auth.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          requestId: { type: "string" },
          traceId: { type: "string" },
        },
        required: ["error"],
      },
      AuthLoginRequest: {
        type: "object",
        required: ["username", "password"],
        properties: {
          username: { type: "string", example: "admin" },
          password: { type: "string", format: "password" },
        },
      },
      AuthLoginResponse: {
        type: "object",
        properties: {
          token: {
            type: "string",
            description:
              "JWT access token (also set as httpOnly cookie spybot_access). " +
              "Deprecated: avoid storing in JS.",
          },
          user: {
            type: "object",
            properties: {
              id: { type: "string" },
              username: { type: "string" },
              roles: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
      ScrapeJobKind: {
        type: "string",
        enum: [
          "khanan_date_range",
          "vehicle_permit_snapshot",
          "vehicle_insurance_snapshot",
          "vehicle_fitness_snapshot",
          "vehicle_registration_snapshot",
          "consigner_digest",
          "trip_intelligence_rollup",
          "raw_challan_backfill",
        ],
      },
      ScrapeJobEnqueueRequest: {
        type: "object",
        required: ["kind"],
        properties: {
          kind: { $ref: "#/components/schemas/ScrapeJobKind" },
          correlationId: { type: "string", format: "uuid" },
          fromDate: {
            type: "string",
            format: "date",
            description: "Required for khanan_date_range",
          },
          toDate: {
            type: "string",
            format: "date",
            description: "Required for khanan_date_range",
          },
          vehicleRegNo: {
            type: "string",
            description: "Required for vehicle_* and trip_intelligence_rollup kinds",
          },
          consignerKey: {
            type: "string",
            description: "Required for consigner_digest",
          },
        },
      },
      ScrapeJobEnqueueResponse: {
        type: "object",
        properties: {
          jobId: { type: "string" },
          queueName: { type: "string" },
          kind: { $ref: "#/components/schemas/ScrapeJobKind" },
          correlationId: { type: "string" },
          idempotencyKey: { type: "string" },
          idempotent: { type: "boolean" },
          status: { type: "string", example: "queued" },
          priority: { type: "integer" },
          enqueuedAt: { type: "string", format: "date-time" },
        },
      },
      ScrapeJobStatusResponse: {
        type: "object",
        properties: {
          jobId: { type: "string" },
          status: {
            type: "string",
            enum: ["queued", "active", "completed", "failed", "dlq", "unknown"],
          },
          kind: { $ref: "#/components/schemas/ScrapeJobKind" },
          progress: { type: "number", minimum: 0, maximum: 100 },
          result: { type: "object", nullable: true },
          failedReason: { type: "string", nullable: true },
          timestamps: {
            type: "object",
            properties: {
              processedOn: { type: "string", format: "date-time", nullable: true },
              finishedOn: { type: "string", format: "date-time", nullable: true },
            },
          },
        },
      },
      QueueSample: {
        type: "object",
        properties: {
          waiting: { type: "integer" },
          active: { type: "integer" },
          completed: { type: "integer" },
          failed: { type: "integer" },
          delayed: { type: "integer" },
          prioritized: { type: "integer" },
        },
      },
      QueueMetricRow: {
        type: "object",
        properties: {
          id: { type: "string" },
          queueName: { type: "string" },
          sample: { $ref: "#/components/schemas/QueueSample" },
          recordedAt: { type: "string", format: "date-time" },
        },
      },
      QueueMetricsResponse: {
        type: "object",
        properties: {
          limit: { type: "integer" },
          items: {
            type: "array",
            items: { $ref: "#/components/schemas/QueueMetricRow" },
          },
          latestByQueue: {
            type: "object",
            additionalProperties: { $ref: "#/components/schemas/QueueMetricRow" },
            description: "Latest sample per queue name, keyed by queueName.",
          },
        },
      },
      WorkerStatusRow: {
        type: "object",
        properties: {
          workerId: { type: "string" },
          status: { type: "string", enum: ["idle", "busy", "draining", "offline"] },
          queueName: { type: "string" },
          lastHeartbeat: { type: "string", format: "date-time" },
        },
      },
      HealthResponse: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["ok", "degraded"] },
          service: { type: "string" },
          ts: { type: "string", format: "date-time" },
          contractScrapeJobKindCount: {
            type: "integer",
            description: "Length of `SCRAPE_JOB_KINDS` shipped with this binary (contract parity).",
          },
          metricsEnabled: {
            type: "boolean",
            description: "Whether `METRICS_ENABLED` exposes `/metrics` on this process.",
          },
          checks: {
            type: "object",
            properties: {
              redis: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  latencyMs: { type: "number", nullable: true },
                },
              },
              queue: {
                type: "object",
                properties: {
                  connected: { type: "boolean" },
                  depthByName: {
                    type: "object",
                    additionalProperties: { type: "integer" },
                  },
                },
              },
              worker: {
                type: "object",
                properties: {
                  rows: { type: "integer" },
                  fresh: { type: "boolean", nullable: true },
                  lastHeartbeatAgeMs: { type: "number", nullable: true },
                },
              },
            },
          },
        },
      },
    },
  },
  security: [{ cookieAuth: [] }],
  paths: {
    "/health": {
      get: {
        tags: ["health"],
        summary: "Service health with queue/worker/Redis snapshot",
        security: [],
        responses: {
          200: {
            description: "All checks pass",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthResponse" },
              },
            },
          },
          503: {
            description: "One or more checks degraded",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthResponse" },
              },
            },
          },
        },
      },
    },
    "/api/health/pg": {
      get: {
        tags: ["health"],
        summary: "Postgres connectivity smoke (`SELECT 1` + user count)",
        security: [],
        responses: {
          200: {
            description: "Postgres reachable",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    database: { type: "string" },
                    userCount: { type: "integer" },
                  },
                },
              },
            },
          },
          503: {
            description: "Postgres unreachable",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/auth/login": {
      post: {
        tags: ["auth"],
        summary: "Login — sets httpOnly cookies + returns token body",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthLoginRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Login successful; sets spybot_access / spybot_refresh / spybot_csrf cookies",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthLoginResponse" },
              },
            },
          },
          401: {
            description: "Invalid credentials",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/auth/refresh": {
      post: {
        tags: ["auth"],
        summary: "Rotate refresh token — issues new access + refresh cookies",
        security: [],
        responses: {
          200: { description: "Tokens rotated; cookies updated" },
          401: {
            description: "Refresh token invalid / expired / replayed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/auth/logout": {
      post: {
        tags: ["auth"],
        summary: "Logout — clears all auth cookies + revokes refresh session",
        responses: {
          200: { description: "Logged out" },
        },
      },
    },
    "/api/auth/register-user": {
      post: {
        tags: ["auth"],
        summary: "Create a new user (ADMIN role required)",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["username", "password"],
                properties: {
                  username: { type: "string" },
                  password: { type: "string", format: "password" },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "User created" },
          403: { description: "Insufficient role" },
        },
      },
    },
    "/api/v1/scrape-jobs": {
      get: {
        tags: ["scrape-jobs"],
        summary: "List recent scrape jobs (Prisma-backed, ingest DB)",
        parameters: [
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 50, minimum: 1, maximum: 200 },
          },
          {
            name: "status",
            in: "query",
            schema: { type: "string", example: "queued" },
            description: "Filter by exact status value",
          },
          {
            name: "q",
            in: "query",
            schema: { type: "string" },
            description: "Substring search across kind / status / id / error",
          },
        ],
        responses: {
          200: {
            description: "Slice of scrape jobs",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ok" },
                    rows: {
                      type: "array",
                      items: { $ref: "#/components/schemas/ScrapeJobStatusResponse" },
                    },
                    meta: {
                      type: "object",
                      properties: {
                        totalApprox: { type: "integer" },
                        asOf: { type: "string", format: "date-time" },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { description: "Not authenticated" },
        },
      },
      post: {
        tags: ["scrape-jobs"],
        summary: "Enqueue a new scrape job",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            schema: { type: "string" },
            description: "Optional client-supplied idempotency key",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ScrapeJobEnqueueRequest" },
            },
          },
        },
        responses: {
          202: {
            description: "Job accepted and enqueued",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ScrapeJobEnqueueResponse" },
              },
            },
          },
          400: { description: "Validation error" },
          401: { description: "Not authenticated" },
          429: { description: "Rate limit exceeded" },
        },
      },
    },
    "/api/v1/scrape-jobs/{jobId}": {
      get: {
        tags: ["scrape-jobs"],
        summary: "Scrape job status by Bull job ID",
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "Job found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ScrapeJobStatusResponse" },
              },
            },
          },
          404: { description: "Job not found" },
          401: { description: "Not authenticated" },
        },
      },
    },
    "/api/v1/scrape-jobs/{jobId}/stream": {
      get: {
        tags: ["scrape-jobs"],
        summary: "SSE stream — job events + heartbeat",
        description:
          "Returns `text/event-stream`. Events: `progress`, `complete`, `error`, `heartbeat`. " +
          "Closes when job reaches terminal state or client disconnects.",
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "SSE stream opened",
            content: { "text/event-stream": { schema: { type: "string" } } },
          },
          401: { description: "Not authenticated" },
        },
      },
    },
    "/api/v1/queues/metrics": {
      get: {
        tags: ["queues"],
        summary: "Queue depth samples from system.queue_metrics (Prisma)",
        parameters: [
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 50, minimum: 1, maximum: 200 },
          },
        ],
        responses: {
          200: {
            description: "Queue metrics payload",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/QueueMetricsResponse" },
              },
            },
          },
          401: { description: "Not authenticated" },
          503: { description: "Ingest DB unavailable" },
        },
      },
    },
    "/api/v1/workers": {
      get: {
        tags: ["workers"],
        summary: "Worker heartbeat / status rows",
        responses: {
          200: {
            description: "Worker status list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    workers: {
                      type: "array",
                      items: { $ref: "#/components/schemas/WorkerStatusRow" },
                    },
                  },
                },
              },
            },
          },
          401: { description: "Not authenticated" },
        },
      },
    },
    "/api/v1/admin/queues/retry-replay": {
      post: {
        tags: ["admin"],
        summary: "DLQ replay — move DLQ jobs back to ingest queue (ADMIN)",
        description:
          "Requires ADMIN role + optional `X-Admin-Token` header + `ADMIN_QUEUE_REPLAY_ENABLED=true`.",
        parameters: [
          {
            name: "X-Admin-Token",
            in: "header",
            schema: { type: "string" },
          },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  limit: {
                    type: "integer",
                    default: 10,
                    description: "Max jobs to replay in this call",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Replay result with replayed count + errors" },
          403: { description: "Insufficient role or replay disabled" },
          401: { description: "Not authenticated" },
        },
      },
    },
    "/api/vehicle/trip-summary": {
      get: {
        tags: ["vehicle"],
        summary: "Paginated CRM vehicle trip summaries (`public` Prisma)",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          {
            name: "page",
            in: "query",
            schema: { type: "integer", default: 1, minimum: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 50, minimum: 1, maximum: 200 },
          },
          {
            name: "vehicleRegNo",
            in: "query",
            schema: { type: "string" },
            description: "Filter by registration number (case-insensitive substring)",
          },
          {
            name: "ownerName",
            in: "query",
            schema: { type: "string" },
            description: "Filter by owner name (case-insensitive substring)",
          },
          {
            name: "status",
            in: "query",
            schema: { type: "string" },
            description: "Filter by CRM pipeline status",
          },
          {
            name: "customerType",
            in: "query",
            schema: { type: "string" },
            description: "Filter by customer type",
          },
          {
            name: "assignedExecutive",
            in: "query",
            schema: { type: "string" },
            description: "Filter by assigned executive",
          },
        ],
        responses: {
          200: { description: "`{ data, pagination }` slice" },
          401: { description: "Not authenticated" },
          500: { description: "Server error" },
        },
      },
      post: {
        tags: ["vehicle"],
        summary: "Upsert a CRM vehicle trip summary row",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["vehicleRegNo"],
                properties: {
                  vehicleRegNo: { type: "string" },
                  totalTrips: { type: "number" },
                  totalMTWeight: { type: "number" },
                  sandTrips: { type: "number" },
                  sandMTWeight: { type: "number" },
                  stoneTrips: { type: "number" },
                  stoneMTWeight: { type: "number" },
                  ownerName: { type: "string" },
                  mobileNo: { type: "string" },
                  make: { type: "string" },
                  model: { type: "string" },
                  gvwKgs: { type: "number" },
                  unladenWeightKgs: { type: "number" },
                  vehicleCategory: { type: "string" },
                  fatherName: { type: "string" },
                  currentFullAddress: { type: "string" },
                  currentPincode: { type: "string" },
                  currentDistrict: { type: "string" },
                  permanentFullAddress: { type: "string" },
                  permanentPincode: { type: "string" },
                  permanentDistrict: { type: "string" },
                  insuranceCompany: { type: "string" },
                  insurancePolicyNo: { type: "string" },
                  insuranceDueDate: { type: "string", format: "date" },
                  permitValidUpto: { type: "string", format: "date" },
                  fitnessValidUpto: { type: "string", format: "date" },
                  pollutionValidUpto: { type: "string", format: "date" },
                  mvTaxPaidUpto: { type: "string", format: "date" },
                  leadSource: { type: "string" },
                  offence: { type: "string" },
                  panNumber: { type: "string" },
                  panAddress: { type: "string" },
                  gstin: { type: "string" },
                  legalName: { type: "string" },
                  gstTradeName: { type: "string" },
                  gstContact: { type: "string" },
                  gstEmail: { type: "string" },
                  khananPhone: { type: "string" },
                  customerType: { type: "string" },
                  status: { type: "string" },
                  nextFollowUp: { type: "string", format: "date-time" },
                  assignedExecutive: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Saved row" },
          400: { description: "Validation error" },
          401: { description: "Not authenticated" },
        },
      },
    },
    "/api/vehicle/trip-summary/{vehicleRegNo}": {
      get: {
        tags: ["vehicle"],
        summary: "Single CRM vehicle trip summary by registration",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          {
            name: "vehicleRegNo",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: { description: "`{ data }` row" },
          404: { description: "Not found" },
          401: { description: "Not authenticated" },
        },
      },
    },
    "/api/vehicle/stats": {
      get: {
        tags: ["vehicle"],
        summary: "Aggregate stats over CRM trip-summary table",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: {
          200: { description: "Counts / sums object" },
          401: { description: "Not authenticated" },
        },
      },
    },
    "/api/vehicle/owners": {
      get: {
        tags: ["vehicle"],
        summary: "Distinct owner names from CRM trip summaries",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: {
          200: {
            description: "Sorted list of distinct owner names",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    owners: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
          401: { description: "Not authenticated" },
        },
      },
    },
    "/api/vehicle/sync": {
      post: {
        tags: ["vehicle"],
        summary: "Trigger CRM aggregation from Khanan source tables",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: {
          200: { description: "Sync summary `{ message, count }`" },
          401: { description: "Not authenticated" },
          500: { description: "Sync failed" },
        },
      },
    },
    "/api/vehicle/v2-intel/{regNorm}/summary": {
      get: {
        tags: ["vehicle"],
        summary:
          "Delegated Nest processed compliance summary (`GET /vehicle/:regNorm/summary`)",
        description:
          "Mounted only when Express `VEHICLE_INTEL_PROXY_TO_NEST=true` and Nest is reachable; path rewrites to Nest `/vehicle/{regNorm}/summary`.",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          {
            name: "regNorm",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: { description: "Nest intelligence payload" },
          401: { description: "Not authenticated" },
          502: { description: "Nest unreachable / proxy misconfigured" },
        },
      },
    },
    "/api/khanan/data": {
      get: {
        tags: ["khanan"],
        summary: "Filtered Khanan rows (legacy public Prisma)",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          {
            name: "district",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "fromDate",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "toDate",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "mineralName",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "vehicleRegNo",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "page",
            in: "query",
            schema: { type: "integer", default: 1, minimum: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 50, minimum: 1, maximum: 200 },
          },
        ],
        responses: {
          200: {
            description: "Paged Khanan payload",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { type: "object" } },
                    pagination: {
                      type: "object",
                      properties: {
                        page: { type: "integer" },
                        limit: { type: "integer" },
                        total: { type: "integer" },
                        pages: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { description: "Not authenticated" },
        },
      },
    },
    "/api/khanan/stats": {
      get: {
        tags: ["khanan"],
        summary: "Aggregate stats over Khanan rows (totals, district/mineral/vehicle counts)",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          {
            name: "fromDate",
            in: "query",
            schema: { type: "string" },
            description: "Start of date range filter",
          },
          {
            name: "toDate",
            in: "query",
            schema: { type: "string" },
            description: "End of date range filter",
          },
        ],
        responses: {
          200: {
            description: "Aggregated Khanan stats",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    totalRecords: { type: "integer" },
                    totalQuantity: { type: "number" },
                    districtCount: { type: "integer" },
                    mineralCount: { type: "integer" },
                    uniqueVehicleCount: { type: "integer" },
                  },
                },
              },
            },
          },
          401: { description: "Not authenticated" },
        },
      },
    },
    "/api/khanan/districts": {
      get: {
        tags: ["khanan"],
        summary: "Distinct districts present in Khanan data",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: {
          200: {
            description: "Sorted district list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    districts: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
          401: { description: "Not authenticated" },
        },
      },
    },
    "/api/khanan/minerals": {
      get: {
        tags: ["khanan"],
        summary: "Distinct mineral names present in Khanan data",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: {
          200: {
            description: "Sorted mineral name list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    minerals: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
          401: { description: "Not authenticated" },
        },
      },
    },
  },
};

/**
 * Simple CDN-backed Swagger UI HTML shell.
 * Loads swagger-ui-bundle from unpkg so no npm package is needed in this service.
 */
function buildSwaggerUiHtml(openapiJsonUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Vahan360 API Docs (v1 Express)</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: ${JSON.stringify(openapiJsonUrl)},
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      deepLinking: true,
    });
  </script>
</body>
</html>`;
}

/**
 * Mount OpenAPI JSON + Swagger UI on the given Express app.
 * Call this from app.js when OPENAPI_ENABLED=true.
 *
 * @param {import('express').Application} app
 * @param {{ basePath?: string }} [opts]
 */
function mountOpenApi(app, opts = {}) {
  const base = (opts.basePath || "/api/docs").replace(/\/$/, "");

  app.get(`${base}/openapi.json`, (_req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json(SPEC);
  });

  app.get([base, `${base}/`], (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.send(buildSwaggerUiHtml(`${base}/openapi.json`));
  });
}

module.exports = { mountOpenApi, SPEC };
