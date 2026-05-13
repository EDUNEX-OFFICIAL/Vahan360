import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createIngestReadonlyPrismaClient } from '@vahan360/db/ingest-client-readonly';
import type { Prisma, PrismaClient } from '@vahan360/db';
import type { Response } from 'express';

import { updatedAtRangeClause } from './list-query.helpers';

type ComplianceSummaryRow = {
  id: string;
  vehicleRegNo: string;
  snapshot: unknown;
  updatedAt: string;
};

@Injectable()
export class ComplianceService implements OnModuleDestroy {
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

  /** Query `limit`: default 50, clamped to 1–200; Prisma `take` is `min(limit, 100)`. */
  private parseRequestedLimit(limitRaw?: string): number {
    if (limitRaw == null || String(limitRaw).trim() === '') {
      return 50;
    }
    const parsed = Number(limitRaw);
    if (!Number.isFinite(parsed)) {
      return 50;
    }
    return Math.min(200, Math.max(1, Math.floor(parsed)));
  }

  async getSummary(
    limitRaw?: string,
    vehicleRegSubstring?: string,
    updatedFromRaw?: string,
    updatedToRaw?: string,
  ): Promise<
    | {
        status: 'ok';
        asOf: string;
        rows: ComplianceSummaryRow[];
        totalApprox: number;
      }
    | {
        status: 'not_implemented';
        asOf: string;
        reason: string;
      }
  > {
    const asOf = new Date().toISOString();
    const take = Math.min(this.parseRequestedLimit(limitRaw), 100);
    const prisma = this.client();
    if (!prisma) {
      return {
        status: 'not_implemented',
        asOf,
        reason:
          'INGEST_DATABASE_URL or DATABASE_URL is not set; cannot load compliance summaries.',
      };
    }

    try {
      const dre = updatedAtRangeClause(updatedFromRaw, updatedToRaw);
      const vr =
        vehicleRegSubstring != null && String(vehicleRegSubstring).trim() !== ''
          ? String(vehicleRegSubstring).trim()
          : undefined;

      const whereClause: Prisma.ProcessedVehicleComplianceSummaryWhereInput = {
        ...(dre ? { updatedAt: dre } : {}),
        ...(vr
          ? {
              vehicleRegNo: { contains: vr, mode: 'insensitive' },
            }
          : {}),
      };

      const [rows, totalApprox] = await Promise.all([
        prisma.processedVehicleComplianceSummary.findMany({
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
        prisma.processedVehicleComplianceSummary.count({ where: whereClause }),
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

  private csvEscapeCell(value: unknown): string {
    const raw = value == null ? '' : String(value);
    if (/[",\n\r]/.test(raw)) {
      return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
  }

  /** Server CSV export cap: default 500 rows, max 5000 (batched Prisma reads). */
  private parseCsvExportCap(limitRaw?: string): number {
    if (limitRaw == null || String(limitRaw).trim() === '') {
      return 500;
    }
    const n = Number(limitRaw);
    if (!Number.isFinite(n)) {
      return 500;
    }
    return Math.min(5000, Math.max(1, Math.floor(n)));
  }

  /**
   * RFC 4180-ish CSV streamed to the client (UTF-8 BOM). Same filters as JSON `GET /compliance/summary`.
   */
  async writeSummaryCsvStream(
    res: Response,
    limitRaw?: string,
    vehicleRegSubstring?: string,
    updatedFromRaw?: string,
    updatedToRaw?: string,
  ): Promise<void> {
    const cap = this.parseCsvExportCap(limitRaw);
    const prisma = this.client();

    const dre = updatedAtRangeClause(updatedFromRaw, updatedToRaw);
    const vr =
      vehicleRegSubstring != null && String(vehicleRegSubstring).trim() !== ''
        ? String(vehicleRegSubstring).trim()
        : undefined;

    const whereClause: Prisma.ProcessedVehicleComplianceSummaryWhereInput = {
      ...(dre ? { updatedAt: dre } : {}),
      ...(vr
        ? {
            vehicleRegNo: { contains: vr, mode: 'insensitive' },
          }
        : {}),
    };

    if (!prisma) {
      res.status(503);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.end('reason\nmissing_ingest_database_url\n');
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="compliance-summary-export.csv"',
    );

    try {
      res.write('\ufeff');
      res.write('id,vehicleRegNo,updatedAt,snapshotJson\n');

      const chunkSize = 200;
      let skip = 0;

      while (skip < cap) {
        const take = Math.min(chunkSize, cap - skip);
        const rows = await prisma.processedVehicleComplianceSummary.findMany({
          where: whereClause,
          orderBy: { updatedAt: 'desc' },
          skip,
          take,
          select: {
            id: true,
            vehicleRegNo: true,
            snapshot: true,
            updatedAt: true,
          },
        });

        if (rows.length === 0) {
          break;
        }

        for (const r of rows) {
          const line =
            [
              this.csvEscapeCell(r.id),
              this.csvEscapeCell(r.vehicleRegNo),
              this.csvEscapeCell(r.updatedAt.toISOString()),
              this.csvEscapeCell(JSON.stringify(r.snapshot ?? null)),
            ].join(',') + '\n';
          res.write(line);
        }

        skip += rows.length;
        if (rows.length < take) {
          break;
        }
      }

      res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.status(500);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.end(`reason\n${this.csvEscapeCell(message)}\n`);
        return;
      }
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
  }
}
