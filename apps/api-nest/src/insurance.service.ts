import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createIngestReadonlyPrismaClient } from '@vahan360/db/ingest-client-readonly';
import type { Prisma, PrismaClient } from '@vahan360/db';
import { rawRowsLinkedToJobTenantWhere } from './ingest-tenant-scope';
import { capturedAtRangeClause } from './list-query.helpers';

export type RawInsuranceExpiringRow = {
  id: string;
  scrapeJobId: string | null;
  contentHash: string;
  sourceUrl: string | null;
  capturedAt: string;
  payload: unknown;
};

@Injectable()
export class InsuranceService implements OnModuleDestroy {
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

  async getExpiring(days: number, tenantId: string, fromIso?: string, toIso?: string): Promise<
    | {
        status: 'ok';
        asOf: string;
        days: number;
        rows: RawInsuranceExpiringRow[];
        totalApprox: number;
      }
    | {
        status: 'not_implemented';
        asOf: string;
        days: number;
        reason: string;
      }
  > {
    const asOf = new Date().toISOString();
    const prisma = this.client();
    if (!prisma) {
      return {
        status: 'not_implemented',
        asOf,
        days,
        reason:
          'INGEST_DATABASE_URL or DATABASE_URL is not set; cannot load raw insurance rows.',
      };
    }

    try {
      const take = 100;
      const datePart = capturedAtRangeClause(fromIso, toIso);
      const tenantWhere = rawRowsLinkedToJobTenantWhere(tenantId) as Prisma.RawInsuranceWhereInput;
      const where: Prisma.RawInsuranceWhereInput =
        datePart && (datePart.gte != null || datePart.lte != null)
          ? { AND: [tenantWhere, { capturedAt: datePart }] }
          : tenantWhere;
      const [rows, totalApprox] = await Promise.all([
        prisma.rawInsurance.findMany({
          where,
          orderBy: { capturedAt: 'desc' },
          take,
          select: {
            id: true,
            scrapeJobId: true,
            contentHash: true,
            sourceUrl: true,
            capturedAt: true,
            payload: true,
          },
        }),
        prisma.rawInsurance.count({ where }),
      ]);

      return {
        status: 'ok',
        asOf,
        days,
        rows: rows.map((r) => ({
          id: String(r.id),
          scrapeJobId: r.scrapeJobId,
          contentHash: r.contentHash,
          sourceUrl: r.sourceUrl,
          capturedAt: r.capturedAt.toISOString(),
          payload: r.payload as unknown,
        })),
        totalApprox,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `Prisma error: ${String(err)}`;
      return { status: 'not_implemented', asOf, days, reason: message };
    }
  }
}
