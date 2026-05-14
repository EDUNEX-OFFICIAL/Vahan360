import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createIngestReadonlyPrismaClient } from '@vahan360/db/ingest-client-readonly';
import type { PrismaClient } from '@vahan360/db';

type OpsSnapshotWorkerRow = {
  workerId: string;
  queueName: string | null;
  status: string;
  lastHeartbeat: string;
};

type OpsSnapshotQueueMetricRow = {
  id: string;
  queueName: string;
  recordedAt: string;
};

@Injectable()
export class OpsSnapshotService implements OnModuleDestroy {
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

  async snapshot(): Promise<
    | {
        status: 'ok';
        asOf: string;
        workers: OpsSnapshotWorkerRow[];
        queueMetrics: OpsSnapshotQueueMetricRow[];
      }
    | { status: 'not_implemented'; asOf: string; reason: string }
  > {
    const asOf = new Date().toISOString();
    const prisma = this.client();
    if (!prisma) {
      return {
        status: 'not_implemented',
        asOf,
        reason:
          'INGEST_DATABASE_URL or DATABASE_URL is not set; cannot load ops snapshot.',
      };
    }

    try {
      const [workers, queueMetrics] = await Promise.all([
        prisma.workerStatus.findMany({
          orderBy: { lastHeartbeat: 'desc' },
          take: 25,
          select: {
            workerId: true,
            queueName: true,
            status: true,
            lastHeartbeat: true,
          },
        }),
        prisma.queueMetric.findMany({
          orderBy: { recordedAt: 'desc' },
          take: 25,
          select: {
            id: true,
            queueName: true,
            recordedAt: true,
          },
        }),
      ]);

      return {
        status: 'ok',
        asOf,
        workers: workers.map((w) => ({
          workerId: w.workerId,
          queueName: w.queueName,
          status: w.status,
          lastHeartbeat: w.lastHeartbeat.toISOString(),
        })),
        queueMetrics: queueMetrics.map((m) => ({
          id: String(m.id),
          queueName: m.queueName,
          recordedAt: m.recordedAt.toISOString(),
        })),
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `Prisma error: ${String(err)}`;
      return { status: 'not_implemented', asOf, reason: message };
    }
  }
}
