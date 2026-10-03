import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { NafathConfig } from './nafath.config';
import { NafathIpGuard } from './nafath-ip.guard';

function contextFor(ip: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip }) }),
  } as unknown as ExecutionContext;
}

describe('NafathIpGuard', () => {
  const guard = new NafathIpGuard({
    callbackAllowedIps: ['195.170.180.7', '195.170.180.6'],
  } as NafathConfig);

  it('allows Nafath source IPs, including IPv4-mapped IPv6', () => {
    expect(guard.canActivate(contextFor('195.170.180.7'))).toBe(true);
    expect(guard.canActivate(contextFor('::ffff:195.170.180.6'))).toBe(true);
  });

  it('rejects anything else', () => {
    expect(() => guard.canActivate(contextFor('8.8.8.8'))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
