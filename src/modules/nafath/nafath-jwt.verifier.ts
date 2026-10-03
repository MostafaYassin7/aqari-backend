import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createPublicKey, JsonWebKey } from 'crypto';
import { NafathClient } from './nafath.client';
import { NAFATH_CONFIG, NAFATH_JWT, NafathConfig } from './nafath.config';
import { NafathTokenError } from './nafath.errors';

export interface NafathTokenPayload {
  aud?: string | string[];
  iss?: string;
  transId?: string;
  status?: string;
  [claim: string]: unknown;
}

const KEYS_TTL_MS = 24 * 60 * 60 * 1000;
const CLOCK_TOLERANCE_SECONDS = 60;
const EXPECTED_ISSUER = 'Nafath App';

@Injectable()
export class NafathJwtVerifier {
  private readonly logger = new Logger(NafathJwtVerifier.name);
  private keys = new Map<string, string>(); // kid -> PEM
  private fetchedAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly client: NafathClient,
    @Inject(NAFATH_JWT) private readonly jwt: JwtService,
    @Inject(NAFATH_CONFIG) private readonly config: NafathConfig,
  ) {}

  async verify(token: string): Promise<NafathTokenPayload> {
    const header = this.decodeHeader(token);
    if (header.alg !== 'RS256') throw new NafathTokenError('unsupported alg');
    if (!header.kid) throw new NafathTokenError('missing kid');

    const pem = await this.getKey(header.kid);

    let payload: NafathTokenPayload;
    try {
      payload = this.jwt.verify<NafathTokenPayload>(token, {
        publicKey: pem,
        algorithms: ['RS256'],
        audience: this.config.audience,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
    } catch (err) {
      throw new NafathTokenError((err as Error).message);
    }

    if (payload.iss !== undefined && payload.iss !== EXPECTED_ISSUER) {
      this.logger.warn(
        `Unexpected Nafath token issuer: ${String(payload.iss)}`,
      );
    }
    return payload;
  }

  private decodeHeader(token: string): { alg?: string; kid?: string } {
    try {
      const [encoded] = token.split('.');
      return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
        alg?: string;
        kid?: string;
      };
    } catch {
      throw new NafathTokenError('malformed token');
    }
  }

  private async getKey(kid: string): Promise<string> {
    let refreshed = false;
    if (Date.now() - this.fetchedAt > KEYS_TTL_MS) {
      await this.refresh();
      refreshed = true;
    }

    let pem = this.keys.get(kid);
    if (!pem && !refreshed) {
      await this.refresh();
      pem = this.keys.get(kid);
    }
    if (!pem) throw new NafathTokenError(`unknown kid ${kid}`);
    return pem;
  }

  private refresh(): Promise<void> {
    this.inflight ??= this.client
      .getJwks()
      .then((jwks) => {
        const next = new Map<string, string>();
        for (const jwk of jwks) {
          if (jwk.kty !== 'RSA' || !jwk.kid) continue;
          try {
            const pem = createPublicKey({
              key: jwk as unknown as JsonWebKey,
              format: 'jwk',
            })
              .export({ type: 'spki', format: 'pem' })
              .toString();
            next.set(jwk.kid, pem);
          } catch {
            this.logger.warn(`Skipping malformed Nafath JWK kid=${jwk.kid}`);
          }
        }
        this.keys = next;
        this.fetchedAt = Date.now();
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }
}
