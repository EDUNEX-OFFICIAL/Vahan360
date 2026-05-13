"use strict";

const crypto = require("crypto");

/** @param {unknown} v */
function normalizeVehicleReg(v) {
  if (typeof v !== "string") return "";
  return v.trim().toUpperCase().replace(/\s+/g, "");
}

/** @param {unknown} value */
function stableJsonHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

/** @param {unknown} v */
function isRecord(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** @param {unknown} maybeArray */
function asArray(maybeArray) {
  return Array.isArray(maybeArray) ? maybeArray : [];
}

/** @param {unknown} v */
function asTrimmedString(v) {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

/** @param {unknown} v */
function asPositiveNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** @param {unknown} raw */
function parsePortalHtmlHints(raw) {
  const html = asTrimmedString(raw);
  if (!html) return { ok: false, hints: [] };
  try {
    const { parseStubPortalHtml } = require("@vahan360/scraper-core");
    return parseStubPortalHtml(html);
  } catch {
    return { ok: false, hints: [] };
  }
}

/** @param {Record<string, unknown>} root @param {string[]} candidates */
function pickFirst(root, candidates) {
  for (const k of candidates) {
    if (k in root) return root[k];
  }
  return undefined;
}

/**
 * Merge per-kind ingest stamps into `processed.vehicle_compliance_summary.snapshot`.
 *
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {string} regNorm
 * @param {string} kind
 * @param {string} scrapeJobId
 * @param {string} correlationId
 * @param {Record<string, unknown>} artifactPayload
 * @param {{ wrote: string[] }} summary
 */
async function upsertComplianceMerge(
  prisma,
  regNorm,
  kind,
  scrapeJobId,
  correlationId,
  artifactPayload,
  summary,
) {
  const existing = await prisma.processedVehicleComplianceSummary.findUnique({
    where: { vehicleRegNo: regNorm },
    select: { snapshot: true },
  });
  /** @type {Record<string, unknown>} */
  let base = {};
  if (
    existing?.snapshot &&
    typeof existing.snapshot === "object" &&
    !Array.isArray(existing.snapshot)
  ) {
    try {
      base = JSON.parse(JSON.stringify(existing.snapshot));
    } catch {
      base = {};
    }
  }
  const prevSources =
    typeof base.sources === "object" &&
    base.sources !== null &&
    !Array.isArray(base.sources)
      ? /** @type {Record<string, unknown>} */ ({ ...base.sources })
      : {};
  prevSources[kind] = {
    scrapeJobId,
    correlationId,
    at: new Date().toISOString(),
    payload: artifactPayload,
  };
  base.sources = prevSources;
  base.lastIngestKind = kind;
  base.lastIngestAt = new Date().toISOString();
  const compliance =
    isRecord(base.compliance) ? { ...base.compliance } : {};
  if (kind === "vehicle_permit_snapshot" && isRecord(artifactPayload.permit)) {
    const permit = artifactPayload.permit;
    compliance.permitValid = permit.isValid === true;
    compliance.permitStatus = asTrimmedString(permit.status) || null;
    compliance.permitValidUntil = asTrimmedString(permit.validUntil) || null;
  }
  if (
    kind === "vehicle_insurance_snapshot" &&
    isRecord(artifactPayload.insurance)
  ) {
    const insurance = artifactPayload.insurance;
    compliance.insuranceValid = insurance.isValid === true;
    compliance.insuranceStatus = asTrimmedString(insurance.status) || null;
    compliance.insuranceValidUntil =
      asTrimmedString(insurance.validUntil) || null;
  }
  if (kind === "vehicle_fitness_snapshot" && isRecord(artifactPayload.fitness)) {
    const fitness = artifactPayload.fitness;
    compliance.fitnessValid = fitness.isValid === true;
    compliance.fitnessStatus = asTrimmedString(fitness.status) || null;
    compliance.fitnessValidUntil = asTrimmedString(fitness.validUntil) || null;
  }
  base.compliance = compliance;
  await prisma.processedVehicleComplianceSummary.upsert({
    where: { vehicleRegNo: regNorm },
    create: { vehicleRegNo: regNorm, snapshot: base },
    update: { snapshot: base },
  });
  summary.wrote.push("processed.vehicle_compliance_summary");
}

/**
 * Best-effort ingest rows for scrape jobs. Real portal HTML still lands via future Playwright handlers;
 * this persists contract-shaped payloads so APIs / dashboards have non-empty tables.
 *
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {string} scrapeJobId
 * @param {string} kind
 * @param {unknown} payload
 * @returns {Promise<Record<string, unknown>>}
 */
async function persistIngestArtifacts(prisma, scrapeJobId, kind, payload) {
  const p =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? /** @type {Record<string, unknown>} */ (payload)
      : {};
  const correlationId =
    typeof p.correlationId === "string" ? p.correlationId : "";
  const summary = {
    kind,
    wrote: /** @type {string[]} */ ([]),
    skippedDuplicate: /** @type {string[]} */ ([]),
  };

  const tryCreate = async (label, fn) => {
    try {
      await fn();
      summary.wrote.push(label);
    } catch (e) {
      if (
        e &&
        typeof e === "object" &&
        "code" in e &&
        e.code === "P2002"
      ) {
        summary.skippedDuplicate.push(label);
        return;
      }
      throw e;
    }
  };

  if (kind === "khanan_date_range") {
    const fromDate = p.fromDate;
    const toDate = p.toDate;
    if (typeof fromDate !== "string" || typeof toDate !== "string") {
      return summary;
    }
    const district =
      typeof p.district === "string" ? p.district.trim() : "";
    const htmlProbe = parsePortalHtmlHints(p.portalHtml);
    const records = asArray(p.records)
      .map((item) => (isRecord(item) ? item : null))
      .filter(Boolean);
    if (records.length > 0) {
      for (const rec of records) {
        const vehicleRegNo = normalizeVehicleReg(
          pickFirst(rec, ["vehicleRegNo", "vehicleNo", "registrationNo"])
        );
        const permitNo = asTrimmedString(
          pickFirst(rec, ["permitNo", "permitNumber", "transitPassNo"])
        );
        const challanNo = asTrimmedString(
          pickFirst(rec, ["challanNo", "challanNumber", "challanId"])
        );
        const quantity = asPositiveNumber(
          pickFirst(rec, ["quantity", "quantityTonnes", "loadQuantity"])
        );
        const normalizedPayload = {
          scrapeJobKind: kind,
          fromDate,
          toDate,
          ...(district ? { district } : {}),
          correlationId,
          htmlProbe,
          record: {
            vehicleRegNo: vehicleRegNo || null,
            permitNo: permitNo || null,
            challanNo: challanNo || null,
            mineralType: asTrimmedString(
              pickFirst(rec, ["mineralType", "material", "commodity"])
            ) || null,
            sourceDistrict:
              asTrimmedString(pickFirst(rec, ["district", "sourceDistrict"])) ||
              (district || null),
            destinationDistrict:
              asTrimmedString(pickFirst(rec, ["destinationDistrict", "destDistrict"])) ||
              null,
            quantity,
            issuedAt:
              asTrimmedString(pickFirst(rec, ["issuedAt", "permitDate", "date"])) ||
              null,
            status: asTrimmedString(pickFirst(rec, ["status", "state"])) || null,
          },
        };
        const contentHash = stableJsonHash({
          scrapeJobId,
          correlationId,
          normalizedPayload,
        });
        await tryCreate("raw_khanan_records", () =>
          prisma.rawKhananRecord.create({
            data: {
              scrapeJobId,
              contentHash,
              payload: normalizedPayload,
              sourceUrl: null,
              districtKey: district || null,
            },
          })
        );
      }
    } else {
      const rowPayload = {
        scrapeJobKind: kind,
        fromDate,
        toDate,
        ...(district ? { district } : {}),
        correlationId,
        htmlProbe,
        recordCount: 0,
      };
      const contentHash = stableJsonHash({
        kind,
        scrapeJobId,
        fromDate,
        toDate,
        district: district || null,
        correlationId,
      });
      await tryCreate("raw_khanan_records", () =>
        prisma.rawKhananRecord.create({
          data: {
            scrapeJobId,
            contentHash,
            payload: rowPayload,
            sourceUrl: null,
            districtKey: district || null,
          },
        })
      );
    }

    if (district) {
      const snap = {
        lastRange: { fromDate, toDate },
        scrapeJobId,
        correlationId,
        lastSeenAt: new Date().toISOString(),
      };
      await prisma.processedDistrictSummary.upsert({
        where: { district },
        create: { district, snapshot: snap },
        update: { snapshot: snap },
      });
      summary.wrote.push("processed.district_summary");
    }
    return summary;
  }

  if (kind === "raw_challan_backfill") {
    const cursor = p.cursor != null ? String(p.cursor) : "";
    const batchSize = p.batchSize;
    const htmlProbe = parsePortalHtmlHints(p.portalHtml);
    const challans = asArray(p.challans)
      .map((item) => (isRecord(item) ? item : null))
      .filter(Boolean);
    if (challans.length > 0) {
      for (const challan of challans) {
        const normalized = {
          scrapeJobKind: kind,
          correlationId,
          ...(cursor ? { cursor } : {}),
          ...(typeof batchSize === "number" ? { batchSize } : {}),
          htmlProbe,
          challan: {
            challanNo:
              asTrimmedString(
                pickFirst(challan, ["challanNo", "challanNumber", "id"])
              ) || null,
            vehicleRegNo: normalizeVehicleReg(
              pickFirst(challan, ["vehicleRegNo", "registrationNo", "vehicleNo"])
            ) || null,
            amount: asPositiveNumber(
              pickFirst(challan, ["amount", "penaltyAmount", "fine"])
            ),
            status: asTrimmedString(
              pickFirst(challan, ["status", "paymentStatus"])
            ) || null,
            violationDate:
              asTrimmedString(
                pickFirst(challan, ["violationDate", "challanDate", "date"])
              ) || null,
            location:
              asTrimmedString(pickFirst(challan, ["location", "place"])) || null,
          },
        };
        const contentHash = stableJsonHash({
          kind,
          scrapeJobId,
          normalized,
        });
        await tryCreate("raw_challans", () =>
          prisma.rawChallan.create({
            data: {
              scrapeJobId,
              contentHash,
              payload: normalized,
              sourceUrl: null,
            },
          })
        );
      }
    } else {
      const rowPayload = {
        scrapeJobKind: kind,
        correlationId,
        ...(cursor ? { cursor } : {}),
        ...(typeof batchSize === "number" ? { batchSize } : {}),
        htmlProbe,
        challanCount: 0,
      };
      const contentHash = stableJsonHash({
        kind,
        scrapeJobId,
        correlationId,
        cursor: cursor || null,
        batchSize: typeof batchSize === "number" ? batchSize : null,
      });
      await tryCreate("raw_challans", () =>
        prisma.rawChallan.create({
          data: {
            scrapeJobId,
            contentHash,
            payload: rowPayload,
            sourceUrl: null,
          },
        })
      );
    }
    return summary;
  }

  if (kind === "vehicle_fitness_snapshot") {
    const reg = normalizeVehicleReg(p.vehicleRegNo);
    if (!reg) return summary;
    const fitness = isRecord(p.fitness) ? p.fitness : {};
    const fitnessValidUntil = asTrimmedString(
      pickFirst(fitness, ["validUntil", "expiryDate", "fitnessUpto"])
    );
    const isValid =
      asTrimmedString(pickFirst(fitness, ["status"]))?.toLowerCase() === "valid" ||
      asTrimmedString(fitnessValidUntil).length > 0;
    const rowPayload = {
      scrapeJobKind: kind,
      vehicleRegNo: reg,
      correlationId,
      fitness: {
        status: asTrimmedString(pickFirst(fitness, ["status", "state"])) || null,
        validUntil: fitnessValidUntil || null,
        issuer: asTrimmedString(pickFirst(fitness, ["issuer", "authority"])) || null,
        isValid,
      },
      htmlProbe: parsePortalHtmlHints(p.portalHtml),
    };
    const contentHash = stableJsonHash({
      kind,
      scrapeJobId,
      vehicleRegNo: reg,
      correlationId,
    });
    await tryCreate("raw_fitness_records", () =>
      prisma.rawFitnessRecord.create({
        data: {
          scrapeJobId,
          contentHash,
          payload: rowPayload,
          sourceUrl: null,
        },
      })
    );
    await upsertComplianceMerge(
      prisma,
      reg,
      kind,
      scrapeJobId,
      correlationId,
      rowPayload,
      summary,
    );
    return summary;
  }

  if (kind === "vehicle_registration_snapshot") {
    const reg = normalizeVehicleReg(p.vehicleRegNo);
    if (!reg) return summary;
    const registration = isRecord(p.registration) ? p.registration : {};
    const rowPayload = {
      scrapeJobKind: kind,
      vehicleRegNo: reg,
      correlationId,
      registration: {
        ownerName: asTrimmedString(
          pickFirst(registration, ["ownerName", "owner", "registeredOwner"])
        ) || null,
        vehicleClass:
          asTrimmedString(pickFirst(registration, ["vehicleClass", "class"])) || null,
        fuelType: asTrimmedString(pickFirst(registration, ["fuelType", "fuel"])) || null,
        registrationDate:
          asTrimmedString(
            pickFirst(registration, ["registrationDate", "registeredAt"])
          ) || null,
        status: asTrimmedString(pickFirst(registration, ["status"])) || null,
      },
      htmlProbe: parsePortalHtmlHints(p.portalHtml),
    };
    const contentHash = stableJsonHash({
      kind,
      scrapeJobId,
      vehicleRegNo: reg,
      correlationId,
    });
    await tryCreate("raw_vehicle_records", () =>
      prisma.rawVehicleRecord.create({
        data: {
          scrapeJobId,
          contentHash,
          payload: rowPayload,
          sourceUrl: null,
        },
      })
    );
    await upsertComplianceMerge(
      prisma,
      reg,
      kind,
      scrapeJobId,
      correlationId,
      rowPayload,
      summary,
    );
    return summary;
  }

  if (kind === "vehicle_permit_snapshot") {
    const reg = normalizeVehicleReg(p.vehicleRegNo);
    if (!reg) return summary;
    const permit = isRecord(p.permit) ? p.permit : {};
    const permitStatus = asTrimmedString(
      pickFirst(permit, ["status", "permitStatus", "state"])
    ).toLowerCase();
    const permitValid = permitStatus
      ? permitStatus === "valid" || permitStatus === "active"
      : null;
    const rowPayload = {
      scrapeJobKind: kind,
      vehicleRegNo: reg,
      correlationId,
      permit: {
        permitNo: asTrimmedString(
          pickFirst(permit, ["permitNo", "permitNumber"])
        ) || null,
        permitType:
          asTrimmedString(pickFirst(permit, ["permitType", "type"])) || null,
        validFrom:
          asTrimmedString(pickFirst(permit, ["validFrom", "issueDate"])) || null,
        validUntil:
          asTrimmedString(pickFirst(permit, ["validUntil", "expiryDate"])) || null,
        status: permitStatus || null,
        isValid: permitValid,
      },
      htmlProbe: parsePortalHtmlHints(p.portalHtml),
    };
    const contentHash = stableJsonHash({
      kind,
      scrapeJobId,
      vehicleRegNo: reg,
      correlationId,
    });
    await tryCreate("raw_permits", () =>
      prisma.rawPermit.create({
        data: {
          scrapeJobId,
          contentHash,
          payload: rowPayload,
          sourceUrl: null,
        },
      })
    );
    await upsertComplianceMerge(
      prisma,
      reg,
      kind,
      scrapeJobId,
      correlationId,
      rowPayload,
      summary,
    );
    return summary;
  }

  if (kind === "vehicle_insurance_snapshot") {
    const reg = normalizeVehicleReg(p.vehicleRegNo);
    if (!reg) return summary;
    const insurance = isRecord(p.insurance) ? p.insurance : {};
    const insuranceStatus = asTrimmedString(
      pickFirst(insurance, ["status", "insuranceStatus", "state"])
    ).toLowerCase();
    const insuranceValid = insuranceStatus
      ? insuranceStatus === "valid" || insuranceStatus === "active"
      : null;
    const rowPayload = {
      scrapeJobKind: kind,
      vehicleRegNo: reg,
      correlationId,
      insurance: {
        policyNo:
          asTrimmedString(
            pickFirst(insurance, ["policyNo", "policyNumber", "insuranceNo"])
          ) || null,
        provider:
          asTrimmedString(pickFirst(insurance, ["provider", "company", "insurer"])) ||
          null,
        validFrom:
          asTrimmedString(pickFirst(insurance, ["validFrom", "issueDate"])) || null,
        validUntil:
          asTrimmedString(pickFirst(insurance, ["validUntil", "expiryDate"])) || null,
        status: insuranceStatus || null,
        isValid: insuranceValid,
      },
      htmlProbe: parsePortalHtmlHints(p.portalHtml),
    };
    const contentHash = stableJsonHash({
      kind,
      scrapeJobId,
      vehicleRegNo: reg,
      correlationId,
    });
    await tryCreate("raw_insurances", () =>
      prisma.rawInsurance.create({
        data: {
          scrapeJobId,
          contentHash,
          payload: rowPayload,
          sourceUrl: null,
        },
      })
    );
    await upsertComplianceMerge(
      prisma,
      reg,
      kind,
      scrapeJobId,
      correlationId,
      rowPayload,
      summary,
    );
    return summary;
  }

  if (kind === "consigner_digest") {
    const key =
      typeof p.consignerKey === "string" ? p.consignerKey.trim() : "";
    if (!key) return summary;
    const rowPayload = {
      stub: true,
      scrapeJobKind: kind,
      consignerKey: key,
      correlationId,
      note: "Placeholder consigner digest row; Khanan aggregation not run yet",
    };
    const contentHash = stableJsonHash({
      kind,
      scrapeJobId,
      consignerKey: key,
      correlationId,
    });
    await tryCreate("raw_khanan_records", () =>
      prisma.rawKhananRecord.create({
        data: {
          scrapeJobId,
          contentHash,
          payload: rowPayload,
          sourceUrl: null,
        },
      })
    );
    const consignerSnap = {
      stub: true,
      scrapeJobId,
      correlationId,
      lastDigestAt: new Date().toISOString(),
    };
    await prisma.processedConsignerSummary.upsert({
      where: { consignerKey: key },
      create: { consignerKey: key, snapshot: consignerSnap },
      update: { snapshot: consignerSnap },
    });
    summary.wrote.push("processed.consigner_summary");
    return summary;
  }

  if (kind === "trip_intelligence_rollup") {
    const reg = normalizeVehicleReg(p.vehicleRegNo);
    if (!reg) return summary;
    const snapshot = {
      stub: true,
      scrapeJobKind: kind,
      correlationId,
      lastRollupAt: new Date().toISOString(),
      note: "Placeholder trip rollup until trip analytics worker runs",
    };
    await prisma.processedVehicleTripSummary.upsert({
      where: { vehicleRegNo: reg },
      create: {
        vehicleRegNo: reg,
        snapshot,
      },
      update: {
        snapshot,
      },
    });
    summary.wrote.push("processed.vehicle_trip_summary");
    return summary;
  }

  return summary;
}

module.exports = { persistIngestArtifacts, normalizeVehicleReg, stableJsonHash };
