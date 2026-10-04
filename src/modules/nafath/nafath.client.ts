import { Inject, Injectable } from '@nestjs/common';
import { NAFATH_CONFIG, NafathConfig } from './nafath.config';
import { NafathApiError } from './nafath.errors';

export interface NafathJwk {
  kty: string;
  kid: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
}

const TIMEOUT_MS = 10_000;

const malformed = () =>
  new NafathApiError(200, null, null, 'Malformed Nafath response');

@Injectable()
export class NafathClient {
  constructor(@Inject(NAFATH_CONFIG) private readonly config: NafathConfig) {}

  async createRequest(p: {
    nationalId: string;
    service: string;
    locale: 'ar' | 'en';
    requestId: string;
    clientIp: string;
  }): Promise<{ transId: string; random: string }> {
    const query = new URLSearchParams({
      local: p.locale,
      requestId: p.requestId,
    });
    const res = await this.call<{ transId?: unknown; random?: unknown } | null>(
      'POST',
      `/api/v1/mfa/request?${query.toString()}`,
      p.clientIp,
      { nationalId: p.nationalId, service: p.service },
    );
    if (typeof res?.transId !== 'string' || typeof res.random !== 'string') {
      throw malformed();
    }
    return { transId: res.transId, random: res.random };
  }

  async getStatus(p: {
    nationalId: string;
    transId: string;
    random: string;
    clientIp: string;
  }): Promise<string> {
    const res = await this.call<{ status?: unknown } | null>(
      'POST',
      '/api/v1/mfa/request/status',
      p.clientIp,
      {
        nationalId: p.nationalId,
        transId: p.transId,
        random: p.random,
      },
    );
    if (typeof res?.status !== 'string') throw malformed();
    return res.status;
  }

  /** Nafath Web (OIDC): signed URL of the Nafath login page for one session. */
  async createWebSession(p: {
    locale: 'ar' | 'en';
    requestId: string;
    clientIp: string;
  }): Promise<{ url: string }> {
    const query = new URLSearchParams({
      locale: p.locale,
      requestId: p.requestId,
    });
    const res = await this.call<{ url?: unknown } | null>(
      'GET',
      `/api/v2/oidc/session?${query.toString()}`,
      p.clientIp,
    );
    if (typeof res?.url !== 'string') throw malformed();
    return { url: res.url };
  }

  /** Nafath Web (OIDC): exchanges the single-use `state` for the signed user JWT. */
  async retrieveWebToken(state: string, clientIp: string): Promise<string> {
    const res = await this.call<{ token?: unknown } | null>(
      'POST',
      '/api/v2/oidc/jwt',
      clientIp,
      { state },
    );
    if (typeof res?.token !== 'string') throw malformed();
    return res.token;
  }

  async getJwks(): Promise<NafathJwk[]> {
    const res = await this.call<{ keys?: unknown } | null>(
      'GET',
      '/api/v1/mfa/jwk',
      this.config.serverIp,
    );
    if (!Array.isArray(res?.keys)) throw malformed();
    return res.keys as NafathJwk[];
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    clientIp: string,
    body?: Record<string, string>,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          'APP-ID': this.config.appId,
          'APP-KEY': this.config.appKey,
          'X-Forwarded-For': `${clientIp},${this.config.serverIp}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new NafathApiError(
        0,
        null,
        null,
        `Nafath call failed: ${(err as Error).message}`,
      );
    }

    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON body (e.g. gateway error page) — handled below via status code.
    }

    if (!res.ok) {
      const errBody = (json ?? {}) as {
        code?: unknown;
        reference?: unknown;
        message?: unknown;
      };
      throw new NafathApiError(
        res.status,
        typeof errBody.code === 'string' ? errBody.code : null,
        typeof errBody.reference === 'string' ||
          typeof errBody.reference === 'number'
          ? errBody.reference
          : null,
        typeof errBody.message === 'string'
          ? errBody.message
          : `HTTP ${res.status}`,
      );
    }

    return json as T;
  }
}
