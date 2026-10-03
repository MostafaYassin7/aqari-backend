import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { NafathRequest } from './entities/nafath-request.entity';
import { NafathAuthController } from './nafath-auth.controller';
import { NafathCallbackController } from './nafath-callback.controller';
import { NafathClient } from './nafath.client';
import { loadNafathConfig, NAFATH_CONFIG, NAFATH_JWT } from './nafath.config';
import { NafathIpGuard } from './nafath-ip.guard';
import { NafathJwtVerifier } from './nafath-jwt.verifier';
import { NafathLinkTokenService } from './nafath-link-token.service';
import { NafathService } from './nafath.service';

@Module({
  imports: [TypeOrmModule.forFeature([NafathRequest, User]), AuthModule],
  controllers: [NafathAuthController, NafathCallbackController],
  providers: [
    { provide: NAFATH_CONFIG, useFactory: () => loadNafathConfig(process.env) },
    // Bare instance: AuthModule's JwtService would force JWT_SECRET over our keys.
    { provide: NAFATH_JWT, useFactory: () => new JwtService() },
    NafathClient,
    NafathJwtVerifier,
    NafathLinkTokenService,
    NafathService,
    NafathIpGuard,
  ],
})
export class NafathModule {}
