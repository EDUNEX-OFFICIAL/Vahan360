import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import type { JwtPayload as JwtStdPayload } from 'jsonwebtoken';
import type { PoolClient } from 'pg';
import { Pool } from 'pg';
import type { AccessJwtPayload, NestJwtUser } from './auth.types';
import { normalizeRolesFromDb } from './rbac.permissions';
import { resolveNestJwtSecret } from './jwt-secret';

type UserRow = {
  token_version: number;
  roles: string[] | null;
  tenant_id: string | null;
};

@Injectable()
export class AuthService {
  private pool: Pool | undefined;

  private getPool(): Pool {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) {
      throw new ServiceUnavailableException(
        'DATABASE_URL is not set — Nest cannot verify sessions against users.',
      );
    }
    if (!this.pool) {
      this.pool = new Pool({ connectionString: url, max: 4 });
    }
    return this.pool;
  }

  /** Verifies Express-issued access JWT and loads `roles` / `token_version` from `public.users`. */
  async authenticateAccessToken(rawToken: string): Promise<NestJwtUser> {
    const secret = resolveNestJwtSecret();
    let decoded: AccessJwtPayload & JwtStdPayload;
    try {
      decoded = jwt.verify(rawToken, secret) as AccessJwtPayload & JwtStdPayload;
    } catch {
      throw new UnauthorizedException('Invalid token.');
    }

    if (decoded.typ != null && String(decoded.typ) !== 'access') {
      throw new UnauthorizedException('Invalid access token.');
    }

    const username =
      typeof decoded.sub === 'string' && decoded.sub.trim().length > 0
        ? decoded.sub.trim()
        : undefined;
    if (!username) {
      throw new UnauthorizedException('Invalid token.');
    }

    const tokenVersion = Number.isFinite(Number(decoded.v)) ? Number(decoded.v) : 0;

    let jwtTenantId: string | null = null;
    if (decoded.tid != null) {
      const s = String(decoded.tid).trim();
      if (s.length > 0) jwtTenantId = s;
    }

    let jwtParentTenantId: string | null = null;
    if (decoded.ptid != null) {
      const s = String(decoded.ptid).trim();
      if (s.length > 0) jwtParentTenantId = s;
    }

    let jwtOrgId: string | null = null;
    if (decoded.oid != null) {
      const s = String(decoded.oid).trim();
      if (s.length > 0) jwtOrgId = s;
    }

    let jwtOrgPath: string | null = null;
    if (decoded.opath != null) {
      const s = String(decoded.opath).trim();
      if (s.length > 0) jwtOrgPath = s;
    }

    const row = await this.loadUserRow(username);
    if (!row) {
      throw new UnauthorizedException('Invalid token.');
    }

    if (tokenVersion !== row.token_version) {
      throw new UnauthorizedException('Token expired due to newer login.');
    }

    const dbTenantRaw = row.tenant_id != null ? String(row.tenant_id).trim() : '';
    const dbTenantId = dbTenantRaw.length > 0 ? dbTenantRaw : null;

    return {
      username,
      roles: normalizeRolesFromDb(row.roles),
      jwtTenantId,
      jwtParentTenantId,
      jwtOrgId,
      jwtOrgPath,
      dbTenantId,
    };
  }

  private async loadUserRow(username: string): Promise<UserRow | null> {
    let client: PoolClient;
    try {
      client = await this.getPool().connect();
    } catch {
      throw new ServiceUnavailableException('User database unreachable.');
    }
    try {
      const r = await client.query<UserRow>(
        `SELECT token_version, roles, tenant_id FROM users WHERE username = $1 LIMIT 1`,
        [username],
      );
      return r.rows[0] ?? null;
    } finally {
      client.release();
    }
  }
}
