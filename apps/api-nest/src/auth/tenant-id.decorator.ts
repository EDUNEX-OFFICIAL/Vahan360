import {
  createParamDecorator,
  type ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';

export const TenantId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const t = req.vahanTenantId;
  if (t == null || String(t).trim() === '') {
    throw new InternalServerErrorException('Tenant context was not initialized.');
  }
  return t;
});
