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

@Injectable()
export class NafathClient {
  constructor(@Inject(NAFATH_CONFIG) private readonly config: NafathConfig) {}

  createRequest(p: {
    nationalId: string;
    service: string;
    locale: 'ar' | 'en';
    requestId: string;
    clientIp: string;
  }): Promise<{ transId: string; random: string }> {
    const query = new URLSearchParams({ local: p.locale, requestId: p.requestId });
    return this.call('POST', `/api/v1/mfa/request?${query.toString()}`, p.clientIp, {
      nationalId: p.nationalId,
      service: p.service,
    });
  }

  async getStatus(p: {
    nationalId: string;
    transId: string;
    random: string;
    clientIp: string;
  }): Promise<string> {
    const res = await this.call<{ status: string }>('POST', '/api/v1/mfa/request/status', p.clientIp, {
      nationalId: p.nationalId,
      transId: p.transId,
      random: p.random,
    });
    return res.status;
  }

  async getJwks(): Promise<NafathJwk[]> {
    const res = await this.call<{ keys?: NafathJwk[] }>('GET', '/api/v1/mfa/jwk', this.config.serverIp);
    return res.keys ?? [];
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
      throw new NafathApiError(0, null, null, `Nafath call failed: ${(err as Error).message}`);
    }

    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON body (e.g. gateway error page) — handled below via status code.
    }

    if (!res.ok) {
      const errBody = (json ?? {}) as { code?: unknown; reference?: unknown; message?: unknown };
      throw new NafathApiError(
        res.status,
        typeof errBody.code === 'string' ? errBody.code : null,
        typeof errBody.reference === 'string' || typeof errBody.reference === 'number'
          ? errBody.reference
          : null,
        typeof errBody.message === 'string' ? errBody.message : `HTTP ${res.status}`,
      );
    }

    return json as T;
  }
}
