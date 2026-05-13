import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createIngestReadonlyPrismaClient } from '@vahan360/db/ingest-client-readonly';
import type { PrismaClient } from '@vahan360/db';
import { rawRowsLinkedToJobTenantWhere } from './ingest-tenant-scope';
type RawChallanListRow = {
  id: string;
  scrapeJobId: string | null;
  contentHash: string;
  capturedAt: string;
  payload: unknown;
};

@Injectable()
export class RawChallanService implements OnModuleDestroy {
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

  async list(
    limit: number,
    tenantId: string,
  ): Promise<
    | {
        status: 'ok';
        asOf: string;
        limit: number;
        take: number;
        total: number;
        rows: RawChallanListRow[];
      }
    | {
        status: 'not_implemented';
        asOf: string;
        limit: number;
        reason: string;
      }
  > {
    const asOf = new Date().toISOString();
    const prisma = this.client();
    const take = Math.min(limit, 100);
    if (!prisma) {
      return {
        status: 'not_implemented',
        asOf,
        limit,
        reason:
          'INGEST_DATABASE_URL or DATABASE_URL is not set; cannot load raw challans.',
      };
    }

    try {
      const tenantWhere = rawRowsLinkedToJobTenantWhere(tenantId);
      const [rows, total] = await Promise.all([
        prisma.rawChallan.findMany({
          where: tenantWhere,
          orderBy: { capturedAt: 'desc' },
          take,
          select: {
            id: true,
            scrapeJobId: true,
            contentHash: true,
            capturedAt: true,
            payload: true,
          },
        }),
        prisma.rawChallan.count({ where: tenantWhere }),
      ]);

      return {
        status: 'ok',
        asOf,
        limit,
        take,
        total,
        rows: rows.map((r) => ({
          id: String(r.id),
          scrapeJobId: r.scrapeJobId,
          contentHash: r.contentHash,
          capturedAt: r.capturedAt.toISOString(),
          payload: r.payload as unknown,
        })),
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `Prisma error: ${String(err)}`;
      return { status: 'not_implemented', asOf, limit, reason: message };
    }
  }
}
