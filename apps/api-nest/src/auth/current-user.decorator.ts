import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { NestJwtUser } from './auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): NestJwtUser => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const user = req.vahanJwtUser;
    if (!user) {
      throw new UnauthorizedException('Missing auth context.');
    }
    return user;
  },
);
