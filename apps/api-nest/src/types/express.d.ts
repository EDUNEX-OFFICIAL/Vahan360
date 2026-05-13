import type { NestJwtUser } from '../auth/auth.types';

declare global {
  namespace Express {
    interface Request {
      vahanJwtUser?: NestJwtUser;
      /** Effective tenant slug after `TenantGuard` (`tid` claim, `X-Tenant-Id`, or DB). */
      vahanTenantId?: string;
    }
  }
}

export {};
