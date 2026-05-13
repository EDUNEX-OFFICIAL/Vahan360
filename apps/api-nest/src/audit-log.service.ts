import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createIngestPrismaClient } from '@vahan360/db/ingest-client';
import type { Prisma, PrismaClient } from '@vahan360/db';

export type AuditLogListRow = {
  id: string;
  action: string;
  resource: string | null;
  createdAt: string;
  actor: string | null;
};

@Injectable()
export class AuditLogService implements OnModuleDestroy {
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
    action?: string,
  ): Promise<
    | {
        status: 'ok';
        asOf: string;
        rows: AuditLogListRow[];
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
    const actionTrim =
      action != null && String(action).trim() !== ''
        ? String(action).trim()
        : undefined;

    const where: Prisma.AuditLogWhereInput | undefined =
      actionTrim !== undefined
        ? {
            action: {
              contains: actionTrim,
              mode: 'insensitive',
            },
          }
        : undefined;

    const prisma = this.client();
    if (!prisma) {
      return {
        status: 'not_implemented',
        asOf,
        limit,
        reason:
          'INGEST_DATABASE_URL or DATABASE_URL is not set; cannot load audit logs.',
      };
    }

    try {
      const [rows, totalApprox] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take,
          select: {
            id: true,
            action: true,
            resource: true,
            createdAt: true,
            actor: true,
          },
        }),
        prisma.auditLog.count({ where }),
      ]);

      return {
        status: 'ok',
        asOf,
        rows: rows.map((r) => ({
          id: String(r.id),
          action: r.action,
          resource: r.resource,
          createdAt: r.createdAt.toISOString(),
          actor: r.actor,
        })),
        totalApprox,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `Prisma error: ${String(err)}`;
      return { status: 'not_implemented', asOf, limit, reason: message };
    }
  }

  /** Best-effort append for operator actions (e.g. failed job replay). */
  async writeEntry(entry: {
    action: string;
    resource?: string | null;
    payload?: Prisma.InputJsonValue;
    actor?: string | null;
  }): Promise<void> {
    const prisma = this.client();
    if (!prisma) return;
    try {
      await prisma.auditLog.create({
        data: {
          action: entry.action,
          resource: entry.resource ?? null,
          payload: entry.payload,
          actor: entry.actor ?? null,
        },
      });
    } catch {
      /* ignore */
    }
  }
}
