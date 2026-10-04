import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { NAFATH_CONFIG, NafathConfig } from './nafath.config';
import { normalizeIp } from './nafath-ip.util';

@Injectable()
export class NafathIpGuard implements CanActivate {
  private readonly logger = new Logger(NafathIpGuard.name);

  constructor(@Inject(NAFATH_CONFIG) private readonly config: NafathConfig) {}

  canActivate(context: ExecutionContext): boolean {
    this.assertAllowed(context.switchToHttp().getRequest<Request>().ip);
    return true;
  }

  /** Throws 403 unless the request comes from one of Nafath's source IPs. */
  assertAllowed(rawIp: string | undefined): void {
    const ip = normalizeIp(rawIp);
    if (ip && this.config.callbackAllowedIps.includes(ip)) return;
    this.logger.warn(`Rejected Nafath callback from ${ip || 'unknown IP'}`);
    throw new ForbiddenException({
      message: 'Forbidden',
      error: 'NAFATH_FORBIDDEN_SOURCE',
    });
  }
}
