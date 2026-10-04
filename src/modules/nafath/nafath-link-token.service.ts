import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NAFATH_CONFIG, NAFATH_JWT, NafathConfig } from './nafath.config';
import { nafathError } from './nafath.errors';

const PURPOSE = 'nafath-link';

/**
 * Short-lived token proving "this client completed Nafath request X".
 * Signed with NAFATH_LINK_TOKEN_SECRET so it can never pass as an Aqar access token.
 */
@Injectable()
export class NafathLinkTokenService {
  constructor(
    @Inject(NAFATH_JWT) private readonly jwt: JwtService,
    @Inject(NAFATH_CONFIG) private readonly config: NafathConfig,
  ) {}

  sign(requestId: string): string {
    return this.jwt.sign(
      { purpose: PURPOSE, rid: requestId },
      {
        secret: this.config.linkTokenSecret,
        algorithm: 'HS256',
        expiresIn: '10m',
      },
    );
  }

  verify(token: string): string {
    try {
      const payload = this.jwt.verify<{ purpose?: unknown; rid?: unknown }>(
        token,
        {
          secret: this.config.linkTokenSecret,
          algorithms: ['HS256'],
        },
      );
      if (payload.purpose !== PURPOSE || typeof payload.rid !== 'string') {
        throw new Error('wrong purpose');
      }
      return payload.rid;
    } catch {
      throw nafathError.linkTokenInvalid();
    }
  }
}
