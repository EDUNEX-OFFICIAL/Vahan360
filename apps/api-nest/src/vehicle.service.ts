import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createIngestReadonlyPrismaClient } from '@vahan360/db/ingest-client-readonly';
import type { Prisma, PrismaClient } from '@vahan360/db';
import {
  jobEventTenantWhere,
  normalizeTenantSlug,
} from './ingest-tenant-scope';
import { getCachedSummary, setCachedSummary } from './vehicle-cache';

export type VehicleSummaryResponse =
  | {
      status: 'ok';
      data: {
        id: string;
        vehicleRegNo: string;
        snapshot: unknown;
        updatedAt: string;
      };
    }
  | { status: 'not_found'; regNorm: string }
  | { status: 'not_implemented'; reason: string };

export type VehicleRiskTier = 'low' | 'medium' | 'high';

export type VehicleRiskResponse =
  | {
      regNorm: string;
      status: 'ok';
      score: number;
      tier: VehicleRiskTier;
      band: VehicleRiskTier;
      signals: string[];
      reasons: string[];
      factors: Array<{
        key: string;
        label: string;
        weight: number;
        contribution: number;
        reason: string;
      }>;
      asOf: string;
    }
  | {
      regNorm: string;
      status: 'not_found';
      score: null;
      tier: null;
      signals: [];
      asOf: string;
    }
  | {
      regNorm: string;
      status: 'not_implemented';
      reason: string;
      score: null;
      tier: null;
      signals: [];
      asOf: string;
    };

export type VehicleTimelineEventRow = {
  id: string;
  type: string;
  occurredAt: string;
  payload: unknown;
};

export type VehicleTimelineResponse =
  | { status: 'ok'; regNorm: string; events: VehicleTimelineEventRow[] }
  | { status: 'not_implemented'; regNorm: string; reason: string };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function riskTierFromScore(score: number): VehicleRiskTier {
  if (score <= 33) return 'low';
  if (score <= 66) return 'medium';
  return 'high';
}

type WeightedRiskFactor = {
  key: string;
  label: string;
  weight: number;
  contribution: number;
  reason: string;
};

function pickNestedValue(
  root: Record<string, unknown>,
  paths: string[][],
): unknown {
  for (const path of paths) {
    let cur: unknown = root;
    let ok = true;
    for (const key of path) {
      if (!isPlainRecord(cur) || !(key in cur)) {
        ok = false;
        break;
      }
      cur = cur[key];
    }
    if (ok) return cur;
  }
  return undefined;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'true' || s === 'yes' || s === '1' || s === 'active' || s === 'valid') return true;
    if (s === 'false' || s === 'no' || s === '0' || s === 'inactive' || s === 'invalid') return false;
  }
  return null;
}

function buildWeightedRiskAssessment(
  snapshot: unknown,
): { score: number; signals: string[]; reasons: string[]; factors: WeightedRiskFactor[] } {
  if (!isPlainRecord(snapshot)) {
    return {
      score: 10,
      signals: ['snapshot_missing_or_non_object'],
      reasons: ['Compliance snapshot missing; using conservative baseline risk.'],
      factors: [
        {
          key: 'data_quality',
          label: 'Data quality',
          weight: 10,
          contribution: 10,
          reason: 'No structured compliance snapshot available.',
        },
      ],
    };
  }

  const factors: WeightedRiskFactor[] = [];
  const signals: string[] = [];
  const maybePush = (factor: WeightedRiskFactor | null, signal: string | null) => {
    if (!factor) return;
    factors.push(factor);
    if (signal) signals.push(signal);
  };

  const permitValid = asBoolean(
    pickNestedValue(snapshot, [
      ['permit', 'isValid'],
      ['permit', 'valid'],
      ['permitStatus', 'isValid'],
      ['compliance', 'permitValid'],
    ]),
  );
  maybePush(
    permitValid === false
      ? {
          key: 'permit_validity',
          label: 'Permit validity',
          weight: 24,
          contribution: 24,
          reason: 'Permit appears expired/invalid in compliance snapshot.',
        }
      : null,
    permitValid === false ? 'permit_invalid' : null,
  );

  const insuranceValid = asBoolean(
    pickNestedValue(snapshot, [
      ['insurance', 'isValid'],
      ['insurance', 'valid'],
      ['compliance', 'insuranceValid'],
    ]),
  );
  maybePush(
    insuranceValid === false
      ? {
          key: 'insurance_validity',
          label: 'Insurance validity',
          weight: 20,
          contribution: 20,
          reason: 'Insurance appears lapsed/invalid.',
        }
      : null,
    insuranceValid === false ? 'insurance_invalid' : null,
  );

  const fitnessValid = asBoolean(
    pickNestedValue(snapshot, [
      ['fitness', 'isValid'],
      ['fitness', 'valid'],
      ['compliance', 'fitnessValid'],
    ]),
  );
  maybePush(
    fitnessValid === false
      ? {
          key: 'fitness_validity',
          label: 'Fitness validity',
          weight: 18,
          contribution: 18,
          reason: 'Fitness certificate appears invalid/expired.',
        }
      : null,
    fitnessValid === false ? 'fitness_invalid' : null,
  );

  const violationCount = Math.max(
    0,
    asFiniteNumber(
      pickNestedValue(snapshot, [
        ['violations', 'count'],
        ['challan', 'count'],
        ['challanCount'],
        ['penaltyCount'],
      ]),
    ) ?? 0,
  );
  if (violationCount > 0) {
    const contribution = Math.min(22, violationCount * 4);
    maybePush(
      {
        key: 'violation_history',
        label: 'Violation history',
        weight: 22,
        contribution,
        reason: `Vehicle has ${violationCount} recorded violations/challans.`,
      },
      `violations=${violationCount}`,
    );
  }

  const blacklisted = asBoolean(
    pickNestedValue(snapshot, [
      ['blacklist', 'isBlacklisted'],
      ['flags', 'blacklisted'],
      ['flags', 'suspended'],
    ]),
  );
  maybePush(
    blacklisted === true
      ? {
          key: 'enforcement_flags',
          label: 'Enforcement flags',
          weight: 16,
          contribution: 16,
          reason: 'Vehicle has blacklist/suspension enforcement signal.',
        }
      : null,
    blacklisted === true ? 'enforcement_blacklist_or_suspend' : null,
  );

  const computed = factors.reduce((acc, f) => acc + f.contribution, 0);
  const baseline = factors.length === 0 ? 8 : 0;
  const score = Math.min(100, Math.max(0, computed + baseline));
  const reasons =
    factors.length > 0
      ? factors
          .slice()
          .sort((a, b) => b.contribution - a.contribution)
          .map((f) => f.reason)
      : ['No high-risk factors found in snapshot.'];
  const safeSignals = signals.length > 0 ? signals : ['no_high_risk_signals'];

  return { score, signals: safeSignals, reasons, factors };
}

function normRegField(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

/** Whether a job/event JSON blob references the normalized registration. */
function jsonReferencesRegNorm(
  regNorm: string,
  eventPayload: unknown,
  jobPayload: unknown,
): boolean {
  if (isPlainRecord(jobPayload) && normRegField(jobPayload.vehicleRegNo) === regNorm) {
    return true;
  }
  if (!isPlainRecord(eventPayload)) {
    return false;
  }
  if (normRegField(eventPayload.registrationNoNorm) === regNorm) return true;
  if (normRegField(eventPayload.vehicleRegNo) === regNorm) return true;
  const jp = eventPayload.jobPayload;
  if (isPlainRecord(jp) && normRegField(jp.vehicleRegNo) === regNorm) return true;
  return false;
}

function timelineWhereByJsonPaths(regNorm: string, tenantId: string): Prisma.JobEventWhereInput {
  const t = normalizeTenantSlug(tenantId);
  return {
    AND: [timelineWhereByRegPathsOnly(regNorm), jobEventTenantWhere(t)],
  };
}

function timelineWhereByRegPathsOnly(regNorm: string): Prisma.JobEventWhereInput {
  return {
    OR: [
      { job: { payload: { path: ['vehicleRegNo'], equals: regNorm } } },
      { payload: { path: ['registrationNoNorm'], equals: regNorm } },
      { payload: { path: ['vehicleRegNo'], equals: regNorm } },
      { payload: { path: ['jobPayload', 'vehicleRegNo'], equals: regNorm } },
    ],
  };
}

@Injectable()
export class VehicleService implements OnModuleDestroy {
  private prisma: PrismaClient | null = null;

  private ingestDatabaseUrl(): string | undefined {
    const raw =
      process.env.INGEST_DATABASE_URL?.trim() ||
      process.env.DATABASE_URL?.trim();
    return raw && raw.length > 0 ? raw : undefined;
  }

  private client(): PrismaClient | null {
    const url = this.ingestDatabaseUrl();
    if (!url) return null;
    if (!this.prisma) {
      this.prisma = createIngestReadonlyPrismaClient({
        datasources: { db: { url } },
      });
    }
    return this.prisma;
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma?.$disconnect();
  }

  normalizeRegNorm(regNorm: string): string {
    return regNorm.trim().toUpperCase();
  }

  async getComplianceSummary(regNormRaw: string): Promise<VehicleSummaryResponse> {
    const regNorm = this.normalizeRegNorm(regNormRaw);

    const cached = await getCachedSummary<VehicleSummaryResponse>(regNorm);
    if (cached !== null) return cached;

    const prisma = this.client();
    if (!prisma) {
      return {
        status: 'not_implemented',
        reason:
          'INGEST_DATABASE_URL or DATABASE_URL is not set; cannot load processed vehicle summary.',
      };
    }

    try {
      const row = await prisma.processedVehicleComplianceSummary.findUnique({
        where: { vehicleRegNo: regNorm },
        select: {
          id: true,
          vehicleRegNo: true,
          snapshot: true,
          updatedAt: true,
        },
      });

      const result: VehicleSummaryResponse = row
        ? {
            status: 'ok',
            data: {
              id: row.id,
              vehicleRegNo: row.vehicleRegNo,
              snapshot: row.snapshot as unknown,
              updatedAt: row.updatedAt.toISOString(),
            },
          }
        : { status: 'not_found', regNorm };

      await setCachedSummary(regNorm, result);
      return result;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `Prisma error: ${String(err)}`;
      return { status: 'not_implemented', reason: message };
    }
  }

  async getVehicleRisk(regNormRaw: string, asOfIso: string): Promise<VehicleRiskResponse> {
    const regNorm = this.normalizeRegNorm(regNormRaw);
    const summary = await this.getComplianceSummary(regNormRaw);

    if (summary.status === 'not_found') {
      return {
        regNorm: summary.regNorm,
        status: 'not_found',
        score: null,
        tier: null,
        signals: [],
        asOf: asOfIso,
      };
    }

    if (summary.status === 'not_implemented') {
      return {
        regNorm,
        status: 'not_implemented',
        reason: summary.reason,
        score: null,
        tier: null,
        signals: [],
        asOf: asOfIso,
      };
    }

    const computed = buildWeightedRiskAssessment(summary.data.snapshot);
    const band = riskTierFromScore(computed.score);

    return {
      regNorm,
      status: 'ok',
      score: computed.score,
      tier: band,
      band,
      signals: computed.signals,
      reasons: computed.reasons,
      factors: computed.factors,
      asOf: asOfIso,
    };
  }

  async getVehicleTimeline(
    regNormRaw: string,
    limit: number,
    tenantId: string,
  ): Promise<VehicleTimelineResponse> {
    const regNorm = this.normalizeRegNorm(regNormRaw);
    const tenantNorm = normalizeTenantSlug(tenantId);
    const effectiveLimit = Math.min(200, Math.max(1, Math.floor(limit)));
    const prisma = this.client();
    if (!prisma) {
      return {
        status: 'not_implemented',
        regNorm,
        reason:
          'INGEST_DATABASE_URL or DATABASE_URL is not set; cannot load job timeline.',
      };
    }

    const mapRows = (
      rows: Array<{
        id: bigint;
        eventType: string;
        occurredAt: Date;
        payload: unknown;
      }>,
    ): VehicleTimelineEventRow[] =>
      rows.map((row) => ({
        id: String(row.id),
        type: row.eventType,
        occurredAt: row.occurredAt.toISOString(),
        payload: row.payload ?? null,
      }));

    try {
      const filtered = await prisma.jobEvent.findMany({
        where: timelineWhereByJsonPaths(regNorm, tenantNorm),
        orderBy: { occurredAt: 'desc' },
        take: effectiveLimit,
        select: {
          id: true,
          eventType: true,
          occurredAt: true,
          payload: true,
        },
      });
      return {
        status: 'ok',
        regNorm,
        events: mapRows(filtered),
      };
    } catch {
      try {
        const scanTake = Math.min(2000, effectiveLimit * 40);
        const scanned = await prisma.jobEvent.findMany({
          orderBy: { occurredAt: 'desc' },
          take: scanTake,
          select: {
            id: true,
            eventType: true,
            occurredAt: true,
            payload: true,
            job: { select: { payload: true, tenantId: true } },
          },
        });
        const matched = scanned
          .filter(
            (row) =>
              row.job.tenantId === tenantNorm &&
              jsonReferencesRegNorm(regNorm, row.payload, row.job.payload),
          )
          .slice(0, effectiveLimit);
        return {
          status: 'ok',
          regNorm,
          events: mapRows(matched),
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : `Prisma error: ${String(err)}`;
        return { status: 'not_implemented', regNorm, reason: message };
      }
    }
  }
}
