import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createIngestReadonlyPrismaClient } from '@vahan360/db/ingest-client-readonly';
import type { Prisma, PrismaClient } from '@vahan360/db';
import { scrapeJobTenantWhere } from './ingest-tenant-scope';

type ScrapeJobListRow = {
  id: string;
  kind: string;
  status: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class ScrapeJobService implements OnModuleDestroy {
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
    status: string | undefined,
    tenantId: string,
    textQuery?: string,
  ): Promise<
    | {
        status: 'ok';
        asOf: string;
        rows: ScrapeJobListRow[];
        totalApprox: number;
        filters: { status: string | null; q: string | null };
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
    const statusFilter =
      status != null && String(status).trim() !== ''
        ? String(status).trim()
        : undefined;
    const q =
      textQuery != null && String(textQuery).trim() !== ''
        ? String(textQuery).trim()
        : undefined;
    const tenantPart = scrapeJobTenantWhere(tenantId);
    const uuidLike =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        q ?? '',
      );
    const searchPart: Prisma.ScrapeJobWhereInput | undefined = q
      ? {
          OR: [
            { kind: { contains: q, mode: 'insensitive' } },
            { status: { contains: q, mode: 'insensitive' } },
            ...(uuidLike ? [{ id: { equals: q } }] : []),
            {
              lastError: { contains: q, mode: 'insensitive' },
            },
          ],
        }
      : undefined;

    const andParts = [tenantPart, statusFilter ? { status: statusFilter } : undefined, searchPart].filter(Boolean) as Prisma.ScrapeJobWhereInput[];
    const where: Prisma.ScrapeJobWhereInput =
      andParts.length <= 1
        ? andParts[0] ?? tenantPart
        : { AND: andParts };

    const prisma = this.client();
    if (!prisma) {
      return {
        status: 'not_implemented',
        asOf,
        limit,
        reason:
          'INGEST_DATABASE_URL or DATABASE_URL is not set; cannot load scrape jobs.',
      };
    }

    try {
      const [rows, totalApprox] = await Promise.all([
        prisma.scrapeJob.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take,
          select: {
            id: true,
            kind: true,
            status: true,
            priority: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.scrapeJob.count({ where }),
      ]);

      return {
        status: 'ok',
        asOf,
        rows: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          status: r.status,
          priority: r.priority,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
        totalApprox,
        filters: { status: statusFilter ?? null, q: q ?? null },
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `Prisma error: ${String(err)}`;
      return { status: 'not_implemented', asOf, limit, reason: message };
    }
  }
}
