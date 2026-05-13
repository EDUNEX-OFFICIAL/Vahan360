import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createIngestReadonlyPrismaClient } from '@vahan360/db/ingest-client-readonly';
import type { Prisma, PrismaClient } from '@vahan360/db';

import { updatedAtRangeClause } from './list-query.helpers';

export type TripsSummaryRow = {
  id: string;
  vehicleRegNo: string;
  snapshot: unknown;
  updatedAt: string;
};

@Injectable()
export class TripsService implements OnModuleDestroy {
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

  private parseLimit(limitRaw?: string): number {
    const parsed = limitRaw != null ? Number(limitRaw) : 20;
    if (!Number.isFinite(parsed) || parsed < 1) {
      return 20;
    }
    return Math.min(Math.floor(parsed), 100);
  }

  async getSummary(
    limitRaw?: string,
    updatedFromRaw?: string,
    updatedToRaw?: string,
    vehicleSubstring?: string,
  ): Promise<
    | {
        status: 'ok';
        asOf: string;
        rows: TripsSummaryRow[];
        totalApprox: number;
      }
    | {
        status: 'not_implemented';
        asOf: string;
        reason: string;
      }
  > {
    const asOf = new Date().toISOString();
    const take = this.parseLimit(limitRaw);
    const prisma = this.client();
    if (!prisma) {
      return {
        status: 'not_implemented',
        asOf,
        reason:
          'INGEST_DATABASE_URL or DATABASE_URL is not set; cannot load trip summaries.',
      };
    }

    try {
      const dre = updatedAtRangeClause(updatedFromRaw, updatedToRaw);
      const qsub =
        vehicleSubstring != null && String(vehicleSubstring).trim() !== ''
          ? String(vehicleSubstring).trim()
          : undefined;

      const whereClause: Prisma.ProcessedVehicleTripSummaryWhereInput = {
        ...(dre ? { updatedAt: dre } : {}),
        ...(qsub
          ? {
              vehicleRegNo: { contains: qsub, mode: 'insensitive' },
            }
          : {}),
      };

      const [rows, totalApprox] = await Promise.all([
        prisma.processedVehicleTripSummary.findMany({
          where: whereClause,
          orderBy: { updatedAt: 'desc' },
          take,
          select: {
            id: true,
            vehicleRegNo: true,
            snapshot: true,
            updatedAt: true,
          },
        }),
        prisma.processedVehicleTripSummary.count({ where: whereClause }),
      ]);

      return {
        status: 'ok',
        asOf,
        rows: rows.map((r) => ({
          id: r.id,
          vehicleRegNo: r.vehicleRegNo,
          snapshot: r.snapshot as unknown,
          updatedAt: r.updatedAt.toISOString(),
        })),
        totalApprox,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `Prisma error: ${String(err)}`;
      return { status: 'not_implemented', asOf, reason: message };
    }
  }
}
