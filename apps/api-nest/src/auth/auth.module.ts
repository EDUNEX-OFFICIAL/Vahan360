import { Global, Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { TenantGuard } from './tenant.guard';

@Global()
@Module({
  providers: [AuthService, JwtAuthGuard, RolesGuard, TenantGuard, Reflector],
  exports: [AuthService, JwtAuthGuard, RolesGuard, TenantGuard, Reflector],
})
export class AuthModule {}
