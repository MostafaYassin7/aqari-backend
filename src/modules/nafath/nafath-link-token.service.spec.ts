import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NafathConfig } from './nafath.config';
import { NafathLinkTokenService } from './nafath-link-token.service';

describe('NafathLinkTokenService', () => {
  const jwt = new JwtService();
  const service = new NafathLinkTokenService(jwt, { linkTokenSecret: 'link-secret' } as NafathConfig);

  it('round-trips the request id', () => {
    expect(service.verify(service.sign('req-1'))).toBe('req-1');
  });

  it('rejects tokens signed with another secret (e.g. JWT_SECRET)', () => {
    const forged = jwt.sign({ purpose: 'nafath-link', rid: 'req-1' }, { secret: 'jwt-secret' });
    expect(() => service.verify(forged)).toThrow(UnauthorizedException);
  });

  it('rejects tokens with the wrong purpose', () => {
    const other = jwt.sign({ purpose: 'something-else', rid: 'req-1' }, { secret: 'link-secret' });
    expect(() => service.verify(other)).toThrow(UnauthorizedException);
  });

  it('rejects expired tokens', () => {
    const expired = jwt.sign(
      { purpose: 'nafath-link', rid: 'req-1', exp: Math.floor(Date.now() / 1000) - 10 },
      { secret: 'link-secret' },
    );
    expect(() => service.verify(expired)).toThrow(UnauthorizedException);
  });
});
