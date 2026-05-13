import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createIngestPrismaClient } from '@vahan360/db/ingest-client';
import type { Prisma, PrismaClient } from '@vahan360/db';
import { failedJobTenantWhere } from './ingest-tenant-scope';

export type FailedJobOrder = 'desc' | 'asc';

export type FailedJobListRow = {
  id: string;
  queueName: string;
  jobName: string | null;
  bullJobId: string | null;
  correlationId: string | null;
  scrapeJobId: string | null;
  payload: unknown;
  errorMessage: string;
  errorStack: string | null;
  attempts: number;
  createdAt: string;
};

@Injectable()
export class FailedJobService implements OnModuleDestroy {
  private prisma: PrismaClient | null = null;

  private ingestDatabaseUrl(): string | undefined {
    const raw =
      process.env.INGEST_DATABASE_URL?.trim() ||
      process.env.DATABASE_URL?.trim();
    return raw && raw.length > 0 ? raw : undefined;
  }

  /** True when ingest Prisma can be constructed (env present). */
  ingestDbConfigured(): boolean {
    return this.ingestDatabaseUrl() !== undefined;
  }

  private client(): PrismaClient | null {
    const url = this.ingestDatabaseUrl();
    if (!url) return null;
    if (!this.prisma) {
      this.prisma = createIngestPrismaClient({
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
    queueName: string | undefined,
    order: FailedJobOrder,
    tenantId: string,
  ): Promise<
    | {
        status: 'ok';
        asOf: string;
        rows: FailedJobListRow[];
        totalApprox: number;
      }
    | {
        status: 'not_implemented';
        asOf: string;
        limit: number;
        reason: string;
      }
  > {
    const asOf = new Date().toISOString();
    const take = Math.min(limit, 100);
    const queueTrim =
      queueName != null && String(queueName).trim() !== ''
        ? String(queueName).trim()
        : undefined;

    const tenantPart = failedJobTenantWhere(tenantId);
    const where: Prisma.FailedJobWhereInput =
      queueTrim !== undefined
        ? { AND: [{ queueName: queueTrim }, tenantPart] }
        : tenantPart;

    const prisma = this.client();
    if (!prisma) {
      return {
        status: 'not_implemented',
        asOf,
        limit,
        reason:
          'INGEST_DATABASE_URL or DATABASE_URL is not set; cannot load failed jobs.',
      };
    }

    const orderDir = order === 'asc' ? 'asc' : 'desc';

    try {
      const [rows, totalApprox] = await Promise.all([
        prisma.failedJob.findMany({
          where,
          orderBy: { createdAt: orderDir },
          take,
          select: {
            id: true,
            queueName: true,
            jobName: true,
            bullJobId: true,
            correlationId: true,
            scrapeJobId: true,
            payload: true,
            errorMessage: true,
            errorStack: true,
            attempts: true,
            createdAt: true,
          },
        }),
        prisma.failedJob.count({ where }),
      ]);

      return {
        status: 'ok',
        asOf,
        rows: rows.map((r) => ({
          id: r.id,
          queueName: r.queueName,
          jobName: r.jobName,
          bullJobId: r.bullJobId,
          correlationId: r.correlationId,
          scrapeJobId: r.scrapeJobId,
          payload: r.payload ?? null,
          errorMessage: r.errorMessage,
          errorStack: r.errorStack,
          attempts: r.attempts,
          createdAt: r.createdAt.toISOString(),
        })),
        totalApprox,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `Prisma error: ${String(err)}`;
      return { status: 'not_implemented', asOf, limit, reason: message };
    }
  }

  async getById(id: string, tenantId: string): Promise<FailedJobListRow | null> {
    const prisma = this.client();
    if (!prisma) return null;
    const tenantPart = failedJobTenantWhere(tenantId);
    try {
      const row = await prisma.failedJob.findFirst({
        where: { AND: [{ id }, tenantPart] },
        select: {
          id: true,
          queueName: true,
          jobName: true,
          bullJobId: true,
          correlationId: true,
          scrapeJobId: true,
          payload: true,
          errorMessage: true,
          errorStack: true,
          attempts: true,
          createdAt: true,
        },
      });
      if (!row) return null;
      return {
        id: row.id,
        queueName: row.queueName,
        jobName: row.jobName,
        bullJobId: row.bullJobId,
        correlationId: row.correlationId,
        scrapeJobId: row.scrapeJobId,
        payload: row.payload ?? null,
        errorMessage: row.errorMessage,
        errorStack: row.errorStack,
        attempts: row.attempts,
        createdAt: row.createdAt.toISOString(),
      };
    } catch {
      return null;
    }
  }
}
