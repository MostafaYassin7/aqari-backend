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
    const ip = normalizeIp(context.switchToHttp().getRequest<Request>().ip);
    if (ip && this.config.callbackAllowedIps.includes(ip)) return true;
    this.logger.warn(`Rejected Nafath callback from ${ip || 'unknown IP'}`);
    throw new ForbiddenException();
  }
}
