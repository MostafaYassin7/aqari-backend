# Nafath Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users log in with Nafath (national ID + approval in the Nafath app) as an alternative to phone OTP, with a one-time phone-OTP link for national IDs not yet tied to an account.

**Architecture:** New `src/modules/nafath/` module. `NafathClient` talks to Elm, `NafathJwtVerifier` verifies Elm's RS256 callback JWTs against the cached JWKS, `NafathService` owns the request lifecycle stored in a new `nafath_requests` table, and two controllers expose `/auth/nafath/*` (app-facing) and `/nafath/callback` (Elm-facing; path registered with Elm). The module imports `AuthModule` to issue the normal Aqar JWT; `AuthModule` is not modified except for a one-line hardening in `JwtStrategy`.

**Tech Stack:** NestJS 11, TypeORM 0.3 (Postgres), `@nestjs/jwt` 11 (jsonwebtoken 9), Node 22 built-in `fetch` and `crypto`, Jest 29 + ts-jest, `@nestjs/throttler` 6, `@nestjs/schedule`.

**Spec:** `docs/superpowers/specs/2026-10-03-nafath-login-design.md`

**Delivery order:** Tasks 1–10 are the **MVP** (end-to-end login working against Nafath production). Task 11 is the manual production smoke test. Tasks 12–13 (rate limiting, cron cleanup) harden it afterwards.

## Global Constraints

- **No new npm dependencies.** Use `crypto.randomUUID()` (the installed `uuid` v13 is ESM-only and breaks Jest), Node `crypto` for JWK→PEM, `fetch` for HTTP.
- **Never use `AuthModule`'s `JwtService` for Nafath tokens.** Its module `secret` (`JWT_SECRET`) takes precedence over any `publicKey`/`secret` you pass (see `getSecretKey` in `node_modules/@nestjs/jwt/dist/jwt.service.js`). Nafath code injects the bare instance under the `NAFATH_JWT` token (`new JwtService()`).
- **Never log** national IDs, JWTs, decoded claims, or `APP-KEY`. Log `requestId`, `transId`, Nafath `code`, `reference`, HTTP status.
- Client-facing errors are thrown as `new XxxException({ message: '<human text>', error: '<CODE>' })` — the existing `HttpExceptionFilter` emits both fields.
- `X-Forwarded-For` value is exactly `` `${clientIp},${serverIp}` `` — comma, **no space**.
- All routes sit under the global prefix `api/v1`.
- Tests: Jest `*.spec.ts` next to the source; construct classes directly with plain mock objects (pattern of `src/modules/bookings/bookings.service.spec.ts`). Run a single file with `npx jest <path>`.
- `users.nationalId` is `select: false` so it never appears in API responses.

## Review Focus

1. **Nafath adds a field to the callback body** → callback must still be accepted (global `ValidationPipe` has `forbidNonWhitelisted: true`). Pinned in Task 10 (`nafath-callback.controller.spec.ts`).
2. **`req.ip` arrives as IPv4-mapped IPv6 (`::ffff:195.170.180.7`)** → IP guard must allow it and `X-Forwarded-For` must carry plain IPv4. Pinned in Task 1 (`normalizeIp`) and Task 10 (guard spec).
3. **App polls status twice concurrently after COMPLETED** → exactly one response carries the token/link token, the other gets 410. Pinned in Task 7.
4. **Callback arrives after polling already marked the row COMPLETED (or Nafath retries the callback)** → 200 no-op, and claims are still back-filled once so we can inspect them in sandbox. Pinned in Task 8.
5. **Production base URL configured with a trailing slash (`https://rabet-nafath.api.elm.sa/`)** → no `//api/v1/...` URLs. Pinned in Task 1.

---

### Task 1: Config loader, error types, IP helper

**Files:**
- Create: `src/modules/nafath/nafath.config.ts`
- Create: `src/modules/nafath/nafath.errors.ts`
- Create: `src/modules/nafath/nafath-ip.util.ts`
- Test: `src/modules/nafath/nafath.config.spec.ts`
- Test: `src/modules/nafath/nafath.errors.spec.ts`

**Interfaces:**
- Produces:
  - `NAFATH_CONFIG: symbol`, `NAFATH_JWT: symbol` (DI tokens)
  - `interface NafathConfig { enabled; baseUrl; appId; appKey; service; audience; serverIp; callbackAllowedIps: string[]; locale: 'ar' | 'en'; decisionSeconds; graceSeconds; linkTokenSecret; retentionDays }`
  - `loadNafathConfig(env: Record<string, string | undefined>): NafathConfig`
  - `NAFATH_CODES` constants, `class NafathApiError(httpStatus: number, code: string | null, reference: string | number | null, message: string)`, `class NafathTokenError(message: string)`, `toHttpError(err: unknown): HttpException`, `nafathError` factory object
  - `normalizeIp(ip: string | undefined): string`

- [ ] **Step 1: Write the failing tests**

`src/modules/nafath/nafath.config.spec.ts`:

```ts
import { loadNafathConfig } from './nafath.config';
import { normalizeIp } from './nafath-ip.util';

const base = {
  NAFATH_ENABLED: 'true',
  NAFATH_BASE_URL: 'https://rabet-nafath.api.elm.sa/',
  NAFATH_APP_ID: 'app-id',
  NAFATH_APP_KEY: 'app-key',
  NAFATH_AUDIENCE: 'AQAR',
  NAFATH_SERVER_IP: '10.0.0.1',
  NAFATH_LINK_TOKEN_SECRET: 'link-secret',
  JWT_SECRET: 'jwt-secret',
};

describe('loadNafathConfig', () => {
  it('applies defaults and strips trailing slashes from the base URL', () => {
    const config = loadNafathConfig(base);

    expect(config.enabled).toBe(true);
    expect(config.baseUrl).toBe('https://rabet-nafath.api.elm.sa');
    expect(config.service).toBe('Login');
    expect(config.callbackAllowedIps).toEqual(['195.170.180.7', '195.170.180.6']);
    expect(config.locale).toBe('ar');
    expect(config.decisionSeconds).toBe(60);
    expect(config.graceSeconds).toBe(20);
    expect(config.retentionDays).toBe(30);
  });

  it('lists every missing required variable when enabled', () => {
    expect(() => loadNafathConfig({ NAFATH_ENABLED: 'true' })).toThrow(
      'Missing Nafath config: NAFATH_BASE_URL, NAFATH_APP_ID, NAFATH_APP_KEY, NAFATH_AUDIENCE, NAFATH_SERVER_IP, NAFATH_LINK_TOKEN_SECRET',
    );
  });

  it('rejects a link-token secret equal to JWT_SECRET', () => {
    expect(() =>
      loadNafathConfig({ ...base, NAFATH_LINK_TOKEN_SECRET: 'jwt-secret' }),
    ).toThrow('NAFATH_LINK_TOKEN_SECRET must differ from JWT_SECRET');
  });

  it('skips validation when disabled', () => {
    expect(loadNafathConfig({}).enabled).toBe(false);
  });

  it('parses the allow-list, trimming and dropping blanks', () => {
    const config = loadNafathConfig({
      ...base,
      NAFATH_CALLBACK_ALLOWED_IPS: ' 1.1.1.1, ,2.2.2.2 ',
    });
    expect(config.callbackAllowedIps).toEqual(['1.1.1.1', '2.2.2.2']);
  });

  it('falls back to defaults for invalid numbers and locale', () => {
    const config = loadNafathConfig({
      ...base,
      NAFATH_DECISION_SECONDS: 'abc',
      NAFATH_GRACE_SECONDS: '-5',
      NAFATH_LOCALE: 'fr',
    });
    expect(config.decisionSeconds).toBe(60);
    expect(config.graceSeconds).toBe(20);
    expect(config.locale).toBe('ar');
  });
});

describe('normalizeIp', () => {
  it('strips the IPv4-mapped IPv6 prefix', () => {
    expect(normalizeIp('::ffff:195.170.180.7')).toBe('195.170.180.7');
  });

  it('leaves plain addresses alone and maps undefined to empty string', () => {
    expect(normalizeIp('195.170.180.6')).toBe('195.170.180.6');
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
    expect(normalizeIp(undefined)).toBe('');
  });
});
```

`src/modules/nafath/nafath.errors.spec.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { NafathApiError, toHttpError } from './nafath.errors';

describe('toHttpError', () => {
  it('maps an active transaction to 409 NAFATH_REQUEST_PENDING', () => {
    const err = toHttpError(new NafathApiError(400, '400-034-050', 77, 'active'));
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ error: 'NAFATH_REQUEST_PENDING' });
  });

  it('maps invalid data to 400 NAFATH_INVALID_REQUEST', () => {
    const err = toHttpError(new NafathApiError(422, '422-031-046', 1, 'invalid'));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ error: 'NAFATH_INVALID_REQUEST' });
  });

  it('maps auth failures, outages and unknown errors to 503 NAFATH_UNAVAILABLE', () => {
    for (const input of [
      new NafathApiError(403, null, null, 'forbidden'),
      new NafathApiError(0, null, null, 'network'),
      new Error('boom'),
    ]) {
      const err = toHttpError(input);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(err.getResponse()).toMatchObject({ error: 'NAFATH_UNAVAILABLE' });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/modules/nafath/nafath.config.spec.ts src/modules/nafath/nafath.errors.spec.ts`
Expected: FAIL — `Cannot find module './nafath.config'` / `'./nafath.errors'`.

- [ ] **Step 3: Implement**

`src/modules/nafath/nafath.config.ts`:

```ts
export const NAFATH_CONFIG = Symbol('NAFATH_CONFIG');
export const NAFATH_JWT = Symbol('NAFATH_JWT');

export interface NafathConfig {
  enabled: boolean;
  baseUrl: string;
  appId: string;
  appKey: string;
  service: string;
  audience: string;
  serverIp: string;
  callbackAllowedIps: string[];
  locale: 'ar' | 'en';
  decisionSeconds: number;
  graceSeconds: number;
  linkTokenSecret: string;
  retentionDays: number;
}

type Env = Record<string, string | undefined>;

const REQUIRED = [
  'NAFATH_BASE_URL',
  'NAFATH_APP_ID',
  'NAFATH_APP_KEY',
  'NAFATH_AUDIENCE',
  'NAFATH_SERVER_IP',
  'NAFATH_LINK_TOKEN_SECRET',
] as const;

const DEFAULT_ALLOWED_IPS = '195.170.180.7,195.170.180.6';

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function loadNafathConfig(env: Env): NafathConfig {
  const enabled = env['NAFATH_ENABLED'] === 'true';

  if (enabled) {
    const missing = REQUIRED.filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing Nafath config: ${missing.join(', ')}`);
    }
    if (env['NAFATH_LINK_TOKEN_SECRET'] === env['JWT_SECRET']) {
      throw new Error('NAFATH_LINK_TOKEN_SECRET must differ from JWT_SECRET');
    }
  }

  return {
    enabled,
    baseUrl: (env['NAFATH_BASE_URL'] ?? '').replace(/\/+$/, ''),
    appId: env['NAFATH_APP_ID'] ?? '',
    appKey: env['NAFATH_APP_KEY'] ?? '',
    service: env['NAFATH_SERVICE'] || 'Login',
    audience: env['NAFATH_AUDIENCE'] ?? '',
    serverIp: env['NAFATH_SERVER_IP'] ?? '',
    callbackAllowedIps: (env['NAFATH_CALLBACK_ALLOWED_IPS'] ?? DEFAULT_ALLOWED_IPS)
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean),
    locale: env['NAFATH_LOCALE'] === 'en' ? 'en' : 'ar',
    decisionSeconds: positiveInt(env['NAFATH_DECISION_SECONDS'], 60),
    graceSeconds: positiveInt(env['NAFATH_GRACE_SECONDS'], 20),
    linkTokenSecret: env['NAFATH_LINK_TOKEN_SECRET'] ?? '',
    retentionDays: positiveInt(env['NAFATH_RETENTION_DAYS'], 30),
  };
}
```

`src/modules/nafath/nafath.errors.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

export const NAFATH_CODES = {
  ACTIVE_TRX: '400-034-050',
  TRX_EXPIRED: '400-034-051',
  TRX_NOT_FOUND: '400-034-053',
  INVALID_REQUEST: '422-031-046',
} as const;

/** Error returned by (or while calling) Elm's Nafath API. httpStatus 0 = network/timeout. */
export class NafathApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string | null,
    readonly reference: string | number | null,
    message: string,
  ) {
    super(message);
    this.name = 'NafathApiError';
  }
}

/** A callback JWT failed verification (signature, kid, alg, aud, expiry). */
export class NafathTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NafathTokenError';
  }
}

export const nafathError = {
  disabled: () =>
    new ServiceUnavailableException({ message: 'Nafath login is not enabled', error: 'NAFATH_DISABLED' }),
  unavailable: () =>
    new ServiceUnavailableException({ message: 'Nafath is unavailable, try again later', error: 'NAFATH_UNAVAILABLE' }),
  pending: () =>
    new ConflictException({
      message: 'A Nafath request is already open for this ID — approve it or try again in about a minute',
      error: 'NAFATH_REQUEST_PENDING',
    }),
  invalidRequest: () =>
    new BadRequestException({ message: 'Nafath rejected the request data', error: 'NAFATH_INVALID_REQUEST' }),
  rateLimited: () =>
    new HttpException({ message: 'Too many Nafath requests for this ID, try again later', error: 'NAFATH_RATE_LIMITED' }, 429),
  notFound: () =>
    new NotFoundException({ message: 'Nafath request not found', error: 'NAFATH_REQUEST_NOT_FOUND' }),
  alreadyUsed: () =>
    new GoneException({ message: 'This Nafath result was already used — start again', error: 'NAFATH_RESULT_ALREADY_USED' }),
  accountInactive: () =>
    new ForbiddenException({ message: 'This account is inactive', error: 'NAFATH_ACCOUNT_INACTIVE' }),
  invalidToken: () =>
    new BadRequestException({ message: 'Invalid Nafath callback', error: 'NAFATH_INVALID_CALLBACK' }),
  linkTokenInvalid: () =>
    new UnauthorizedException({ message: 'Nafath link token is invalid or expired', error: 'NAFATH_LINK_TOKEN_INVALID' }),
  linkInvalid: () =>
    new ConflictException({ message: 'This Nafath result cannot be linked', error: 'NAFATH_LINK_INVALID' }),
  idLinkedToOther: () =>
    new ConflictException({
      message: 'This national ID is already linked to another account',
      error: 'NAFATH_ID_LINKED_TO_OTHER_ACCOUNT',
    }),
  accountHasOtherId: () =>
    new ConflictException({
      message: 'This account is already linked to a different national ID',
      error: 'NAFATH_ACCOUNT_HAS_OTHER_ID',
    }),
};

export function toHttpError(err: unknown): HttpException {
  if (err instanceof NafathApiError) {
    if (err.code === NAFATH_CODES.ACTIVE_TRX) return nafathError.pending();
    if (err.code === NAFATH_CODES.INVALID_REQUEST || err.httpStatus === 422) {
      return nafathError.invalidRequest();
    }
  }
  return nafathError.unavailable();
}
```

`src/modules/nafath/nafath-ip.util.ts`:

```ts
/** Express reports IPv4 clients on dual-stack sockets as "::ffff:a.b.c.d". */
export function normalizeIp(ip: string | undefined): string {
  if (!ip) return '';
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/modules/nafath/nafath.config.spec.ts src/modules/nafath/nafath.errors.spec.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/nafath/nafath.config.ts src/modules/nafath/nafath.errors.ts src/modules/nafath/nafath-ip.util.ts src/modules/nafath/nafath.config.spec.ts src/modules/nafath/nafath.errors.spec.ts
git commit -m "feat(nafath): add config loader, error types and IP helper"
```

---

### Task 2: `NafathClient` (HTTP calls to Elm)

**Files:**
- Create: `src/modules/nafath/nafath.client.ts`
- Test: `src/modules/nafath/nafath.client.spec.ts`

**Interfaces:**
- Consumes: `NAFATH_CONFIG`, `NafathConfig`, `NafathApiError` (Task 1)
- Produces:
  - `interface NafathJwk { kty: string; kid: string; n: string; e: string; alg?: string; use?: string }`
  - `class NafathClient`
    - `createRequest(p: { nationalId: string; service: string; locale: 'ar' | 'en'; requestId: string; clientIp: string }): Promise<{ transId: string; random: string }>`
    - `getStatus(p: { nationalId: string; transId: string; random: string; clientIp: string }): Promise<string>`
    - `getJwks(): Promise<NafathJwk[]>`

- [ ] **Step 1: Write the failing test**

`src/modules/nafath/nafath.client.spec.ts`:

```ts
import { NafathClient } from './nafath.client';
import { NafathConfig } from './nafath.config';
import { NafathApiError } from './nafath.errors';

const config = {
  baseUrl: 'https://nafath.test/nafath-sandbox',
  appId: 'APP',
  appKey: 'KEY',
  serverIp: '10.0.0.1',
} as NafathConfig;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('NafathClient', () => {
  let fetchMock: jest.SpyInstance;
  const client = new NafathClient(config);

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  it('creates a request with auth headers, query params and body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { transId: 't-1', random: '80' }));

    const result = await client.createRequest({
      nationalId: '1000000001',
      service: 'Login',
      locale: 'en',
      requestId: 'r-1',
      clientIp: '5.5.5.5',
    });

    expect(result).toEqual({ transId: 't-1', random: '80' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://nafath.test/nafath-sandbox/api/v1/mfa/request?local=en&requestId=r-1');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'APP-ID': 'APP',
      'APP-KEY': 'KEY',
      'X-Forwarded-For': '5.5.5.5,10.0.0.1',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({ nationalId: '1000000001', service: 'Login' });
  });

  it('reads the status from the status endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'COMPLETED' }));

    const status = await client.getStatus({
      nationalId: '1000000001',
      transId: 't-1',
      random: '80',
      clientIp: '5.5.5.5',
    });

    expect(status).toBe('COMPLETED');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://nafath.test/nafath-sandbox/api/v1/mfa/request/status');
    expect(JSON.parse(init.body as string)).toEqual({
      nationalId: '1000000001',
      transId: 't-1',
      random: '80',
    });
  });

  it('fetches the JWKS with GET and no body', async () => {
    const keys = [{ kty: 'RSA', kid: 'k1', n: 'n', e: 'AQAB', alg: 'RS256', use: 'sig' }];
    fetchMock.mockResolvedValue(jsonResponse(200, { keys }));

    await expect(client.getJwks()).resolves.toEqual(keys);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://nafath.test/nafath-sandbox/api/v1/mfa/jwk');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('turns Nafath error bodies into NafathApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { status: '400', code: '400-034-050', message: 'Invalid Request, There Is Active Trx', reference: 77 }),
    );

    await expect(
      client.createRequest({ nationalId: '1', service: 'Login', locale: 'ar', requestId: 'r', clientIp: '5.5.5.5' }),
    ).rejects.toMatchObject({ name: 'NafathApiError', httpStatus: 400, code: '400-034-050', reference: 77 });
  });

  it('handles non-JSON error bodies', async () => {
    fetchMock.mockResolvedValue(new Response('Service Unavailable', { status: 503 }));

    await expect(client.getJwks()).rejects.toMatchObject({ httpStatus: 503, code: null, reference: null });
  });

  it('wraps network failures with httpStatus 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const err = await client.getJwks().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NafathApiError);
    expect(err).toMatchObject({ httpStatus: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/nafath/nafath.client.spec.ts`
Expected: FAIL — `Cannot find module './nafath.client'`.

- [ ] **Step 3: Implement**

`src/modules/nafath/nafath.client.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/modules/nafath/nafath.client.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/nafath/nafath.client.ts src/modules/nafath/nafath.client.spec.ts
git commit -m "feat(nafath): add HTTP client for Elm Nafath API"
```

---

### Task 3: `NafathJwtVerifier` (JWKS cache + RS256 verification)

**Files:**
- Create: `src/modules/nafath/nafath-jwt.verifier.ts`
- Test: `src/modules/nafath/nafath-jwt.verifier.spec.ts`

**Interfaces:**
- Consumes: `NafathClient.getJwks()` (Task 2); `NAFATH_CONFIG`, `NAFATH_JWT`, `NafathTokenError` (Task 1)
- Produces:
  - `interface NafathTokenPayload { aud?: string | string[]; iss?: string; transId?: string; status?: string; [claim: string]: unknown }`
  - `class NafathJwtVerifier { verify(token: string): Promise<NafathTokenPayload> }`
  - Throws `NafathTokenError` for bad tokens; propagates `NafathApiError` if the JWKS fetch fails.

- [ ] **Step 1: Write the failing test**

`src/modules/nafath/nafath-jwt.verifier.spec.ts`:

```ts
import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync } from 'crypto';
import { NafathJwk } from './nafath.client';
import { NafathConfig } from './nafath.config';
import { NafathTokenError } from './nafath.errors';
import { NafathJwtVerifier } from './nafath-jwt.verifier';

function makeKey(kid: string): { jwk: NafathJwk; pem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const exported = publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string };
  return {
    jwk: { ...exported, kid, alg: 'RS256', use: 'sig' },
    pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

const signer = new JwtService();
const now = () => Math.floor(Date.now() / 1000);

function sign(pem: string, kid: string, claims: Record<string, unknown> = {}): string {
  return signer.sign(
    { aud: 'AQAR', iss: 'Nafath App', transId: 't-1', status: 'COMPLETED', exp: now() + 300, ...claims },
    { privateKey: pem, algorithm: 'RS256', keyid: kid },
  );
}

describe('NafathJwtVerifier', () => {
  const k1 = makeKey('k1');
  const k2 = makeKey('k2');
  const config = { audience: 'AQAR' } as NafathConfig;

  function makeVerifier(...jwksResponses: NafathJwk[][]) {
    const client = { getJwks: jest.fn() };
    for (const keys of jwksResponses) client.getJwks.mockResolvedValueOnce(keys);
    const verifier = new NafathJwtVerifier(client as never, new JwtService(), config);
    return { verifier, client };
  }

  it('verifies a valid token and returns its claims', async () => {
    const { verifier } = makeVerifier([k1.jwk]);
    const payload = await verifier.verify(sign(k1.pem, 'k1', { nin: '1000000001' }));
    expect(payload).toMatchObject({ transId: 't-1', status: 'COMPLETED', nin: '1000000001' });
  });

  it('caches keys between verifications', async () => {
    const { verifier, client } = makeVerifier([k1.jwk]);
    await verifier.verify(sign(k1.pem, 'k1'));
    await verifier.verify(sign(k1.pem, 'k1'));
    expect(client.getJwks).toHaveBeenCalledTimes(1);
  });

  it('refetches once when the kid is unknown (key rotation)', async () => {
    const { verifier, client } = makeVerifier([k1.jwk], [k1.jwk, k2.jwk]);
    await verifier.verify(sign(k1.pem, 'k1'));
    await expect(verifier.verify(sign(k2.pem, 'k2'))).resolves.toMatchObject({ transId: 't-1' });
    expect(client.getJwks).toHaveBeenCalledTimes(2);
  });

  it('rejects a kid that is still unknown after refetching', async () => {
    const { verifier, client } = makeVerifier([k1.jwk], [k1.jwk]);
    await verifier.verify(sign(k1.pem, 'k1'));
    await expect(verifier.verify(sign(k2.pem, 'k2'))).rejects.toThrow(NafathTokenError);
    expect(client.getJwks).toHaveBeenCalledTimes(2);
  });

  it('rejects a token signed by the wrong private key', async () => {
    const { verifier } = makeVerifier([k1.jwk]);
    await expect(verifier.verify(sign(k2.pem, 'k1'))).rejects.toThrow(NafathTokenError);
  });

  it('rejects the wrong audience', async () => {
    const { verifier } = makeVerifier([k1.jwk]);
    await expect(verifier.verify(sign(k1.pem, 'k1', { aud: 'OTHER_SP' }))).rejects.toThrow(NafathTokenError);
  });

  it('allows 60 s clock tolerance but rejects older expiry', async () => {
    const { verifier } = makeVerifier([k1.jwk]);
    await expect(verifier.verify(sign(k1.pem, 'k1', { exp: now() - 30 }))).resolves.toBeDefined();
    await expect(verifier.verify(sign(k1.pem, 'k1', { exp: now() - 120 }))).rejects.toThrow(NafathTokenError);
  });

  it('accepts nbf == exp as in the guide sample (within tolerance)', async () => {
    const { verifier } = makeVerifier([k1.jwk]);
    const t = now();
    await expect(verifier.verify(sign(k1.pem, 'k1', { nbf: t, exp: t }))).resolves.toBeDefined();
  });

  it('rejects non-RS256 tokens without fetching keys', async () => {
    const { verifier, client } = makeVerifier([k1.jwk]);
    const hs = signer.sign({ aud: 'AQAR' }, { secret: 'shared', algorithm: 'HS256', keyid: 'k1' });
    await expect(verifier.verify(hs)).rejects.toThrow('unsupported alg');
    await expect(verifier.verify('not-a-jwt')).rejects.toThrow(NafathTokenError);
    expect(client.getJwks).not.toHaveBeenCalled();
  });

  it('shares one JWKS fetch between concurrent cold verifications', async () => {
    const { verifier, client } = makeVerifier([k1.jwk]);
    await Promise.all([verifier.verify(sign(k1.pem, 'k1')), verifier.verify(sign(k1.pem, 'k1'))]);
    expect(client.getJwks).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/nafath/nafath-jwt.verifier.spec.ts`
Expected: FAIL — `Cannot find module './nafath-jwt.verifier'`.

- [ ] **Step 3: Implement**

`src/modules/nafath/nafath-jwt.verifier.ts`:

```ts
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
      this.logger.warn(`Unexpected Nafath token issuer: ${String(payload.iss)}`);
    }
    return payload;
  }

  private decodeHeader(token: string): { alg?: string; kid?: string } {
    try {
      const [encoded] = token.split('.');
      return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as { alg?: string; kid?: string };
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
          const pem = createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' })
            .export({ type: 'spki', format: 'pem' })
            .toString();
          next.set(jwk.kid, pem);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/modules/nafath/nafath-jwt.verifier.spec.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/nafath/nafath-jwt.verifier.ts src/modules/nafath/nafath-jwt.verifier.spec.ts
git commit -m "feat(nafath): verify callback JWTs against cached Elm JWKS"
```

---

### Task 4: Link tokens + `JwtStrategy` hardening

**Files:**
- Create: `src/modules/nafath/nafath-link-token.service.ts`
- Test: `src/modules/nafath/nafath-link-token.service.spec.ts`
- Modify: `src/modules/auth/strategies/jwt.strategy.ts` (`validate`, currently lines 28–34)
- Test: `src/modules/auth/strategies/jwt.strategy.spec.ts`

**Interfaces:**
- Consumes: `NAFATH_CONFIG`, `NAFATH_JWT`, `nafathError` (Task 1)
- Produces: `class NafathLinkTokenService { sign(requestId: string): string; verify(token: string): string /* returns requestId; throws 401 NAFATH_LINK_TOKEN_INVALID */ }`

- [ ] **Step 1: Write the failing tests**

`src/modules/nafath/nafath-link-token.service.spec.ts`:

```ts
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
```

`src/modules/auth/strategies/jwt.strategy.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { JwtPayload, JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  const usersRepo = { findOne: jest.fn() };
  const strategy = new JwtStrategy({ get: () => 'secret' } as never, usersRepo as never);

  beforeEach(() => usersRepo.findOne.mockReset());

  it('rejects payloads without a sub before touching the database', async () => {
    await expect(strategy.validate({} as JwtPayload)).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate({ sub: '' } as JwtPayload)).rejects.toThrow(UnauthorizedException);
    expect(usersRepo.findOne).not.toHaveBeenCalled();
  });

  it('still loads the user for a valid payload', async () => {
    usersRepo.findOne.mockResolvedValue({ id: 'u-1' });
    await expect(
      strategy.validate({ sub: 'u-1', phone: '+966500000001', role: 'USER' }),
    ).resolves.toEqual({ id: 'u-1' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/modules/nafath/nafath-link-token.service.spec.ts src/modules/auth/strategies/jwt.strategy.spec.ts`
Expected: FAIL — link-token module not found; JwtStrategy test fails because `findOne` is called for `{}`.

- [ ] **Step 3: Implement**

`src/modules/nafath/nafath-link-token.service.ts`:

```ts
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
      { secret: this.config.linkTokenSecret, algorithm: 'HS256', expiresIn: '10m' },
    );
  }

  verify(token: string): string {
    try {
      const payload = this.jwt.verify<{ purpose?: unknown; rid?: unknown }>(token, {
        secret: this.config.linkTokenSecret,
        algorithms: ['HS256'],
      });
      if (payload.purpose !== PURPOSE || typeof payload.rid !== 'string') {
        throw new Error('wrong purpose');
      }
      return payload.rid;
    } catch {
      throw nafathError.linkTokenInvalid();
    }
  }
}
```

`src/modules/auth/strategies/jwt.strategy.ts` — replace the `validate` method:

```ts
  async validate(payload: JwtPayload): Promise<User> {
    // TypeORM drops undefined keys from `where`; without this guard a token
    // lacking `sub` would match the first active user.
    if (typeof payload?.sub !== 'string' || !payload.sub) {
      throw new UnauthorizedException('Invalid token');
    }
    const user = await this.usersRepo.findOne({
      where: { id: payload.sub, isActive: true },
    });
    if (!user) throw new UnauthorizedException('User not found or inactive');
    return user;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/modules/nafath/nafath-link-token.service.spec.ts src/modules/auth/strategies/jwt.strategy.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/nafath/nafath-link-token.service.ts src/modules/nafath/nafath-link-token.service.spec.ts src/modules/auth/strategies/jwt.strategy.ts src/modules/auth/strategies/jwt.strategy.spec.ts
git commit -m "feat(nafath): add link tokens; reject sub-less JWTs in JwtStrategy"
```

---

### Task 5: `NafathRequest` entity, `users` columns, migration

**Files:**
- Create: `src/modules/nafath/entities/nafath-request.entity.ts`
- Modify: `src/modules/users/entities/user.entity.ts` (add two columns after `isVerified`, line 31)
- Create: `src/migrations/1790985600000-AddNafathLogin.ts`
- Test: `src/migration-tests/nafath-login-migration.spec.ts`

**Interfaces:**
- Produces:
  - `enum NafathRequestStatus { WAITING, COMPLETED, REJECTED, EXPIRED, FAILED }` (string values equal names)
  - `type NafathStatusSource = 'callback' | 'poll'`
  - `class NafathRequest { id; nationalId; transId: string | null; random: string | null; service; status: NafathRequestStatus; statusSource: NafathStatusSource | null; claims: Record<string, unknown> | null; clientIp; expiresAt: Date; lastPolledAt: Date | null; completedAt: Date | null; consumedAt: Date | null; linkedUserId: string | null; createdAt: Date; updatedAt: Date }`
  - `User.nationalId: string | null` (`select: false`), `User.nafathVerifiedAt: Date | null`

- [ ] **Step 1: Write the failing test**

`src/migration-tests/nafath-login-migration.spec.ts`:

```ts
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';
import { AddNafathLogin1790985600000 } from '../migrations/1790985600000-AddNafathLogin';
import { User } from '../modules/users/entities/user.entity';

describe('AddNafathLogin migration', () => {
  it('adds user columns and creates nafath_requests with constraints', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddNafathLogin1790985600000().up({ query } as unknown as QueryRunner);

    const sql = query.mock.calls.map((c) => c[0] as string).join('\n');
    expect(sql).toContain('ADD "nationalId" character varying(10)');
    expect(sql).toContain('ADD "nafathVerifiedAt" TIMESTAMP');
    expect(sql).toContain('"UQ_users_nationalId" UNIQUE ("nationalId")');
    expect(sql).toContain('CREATE TABLE "nafath_requests"');
    expect(sql).toContain('"UQ_nafath_requests_transId" UNIQUE ("transId")');
    expect(sql).toContain('REFERENCES "users"("id") ON DELETE SET NULL');
    expect(sql).toContain("'WAITING', 'COMPLETED', 'REJECTED', 'EXPIRED', 'FAILED'");
  });

  it('reverts everything', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddNafathLogin1790985600000().down({ query } as unknown as QueryRunner);

    const sql = query.mock.calls.map((c) => c[0] as string).join('\n');
    expect(sql).toContain('DROP TABLE IF EXISTS "nafath_requests"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "nationalId"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "nafathVerifiedAt"');
  });

  it('hides users.nationalId from default selects', () => {
    const column = getMetadataArgsStorage().columns.find(
      (c) => c.target === User && c.propertyName === 'nationalId',
    );
    expect(column?.options.select).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/migration-tests/nafath-login-migration.spec.ts`
Expected: FAIL — `Cannot find module '../migrations/1790985600000-AddNafathLogin'`.

- [ ] **Step 3: Implement**

`src/modules/nafath/entities/nafath-request.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum NafathRequestStatus {
  WAITING = 'WAITING',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  FAILED = 'FAILED',
}

export type NafathStatusSource = 'callback' | 'poll';

@Entity('nafath_requests')
@Index(['nationalId', 'createdAt'])
@Index(['status', 'expiresAt'])
export class NafathRequest {
  /** Also the `requestId` sent to Nafath and returned to the client. */
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 10 })
  nationalId!: string;

  @Column({ type: 'varchar', nullable: true, unique: true })
  transId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  random!: string | null;

  @Column({ type: 'varchar' })
  service!: string;

  @Column({ type: 'varchar', default: NafathRequestStatus.WAITING })
  status!: NafathRequestStatus;

  @Column({ type: 'varchar', nullable: true })
  statusSource!: NafathStatusSource | null;

  /** Verified JWT claims — kept temporarily for sandbox inspection, purged by retention. */
  @Column({ type: 'jsonb', nullable: true })
  claims!: Record<string, unknown> | null;

  @Column({ type: 'varchar' })
  clientIp!: string;

  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastPolledAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  consumedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  linkedUserId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
```

`src/modules/users/entities/user.entity.ts` — insert after the `isVerified` column:

```ts
  /** National ID / Iqama linked via Nafath. Never selected by default. */
  @Column({ type: 'varchar', length: 10, unique: true, nullable: true, select: false })
  nationalId!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  nafathVerifiedAt!: Date | null;
```

`src/migrations/1790985600000-AddNafathLogin.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNafathLogin1790985600000 implements MigrationInterface {
  name = 'AddNafathLogin1790985600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "nationalId" character varying(10)`);
    await queryRunner.query(`ALTER TABLE "users" ADD "nafathVerifiedAt" TIMESTAMP`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_users_nationalId" UNIQUE ("nationalId")`,
    );

    await queryRunner.query(`
      CREATE TABLE "nafath_requests" (
        "id"           uuid              NOT NULL,
        "nationalId"   character varying(10) NOT NULL,
        "transId"      character varying,
        "random"       character varying,
        "service"      character varying NOT NULL,
        "status"       character varying NOT NULL DEFAULT 'WAITING',
        "statusSource" character varying,
        "claims"       jsonb,
        "clientIp"     character varying NOT NULL,
        "expiresAt"    TIMESTAMP         NOT NULL,
        "lastPolledAt" TIMESTAMP,
        "completedAt"  TIMESTAMP,
        "consumedAt"   TIMESTAMP,
        "linkedUserId" uuid,
        "createdAt"    TIMESTAMP         NOT NULL DEFAULT now(),
        "updatedAt"    TIMESTAMP         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_nafath_requests" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_nafath_requests_transId" UNIQUE ("transId"),
        CONSTRAINT "FK_nafath_requests_linkedUserId"
          FOREIGN KEY ("linkedUserId") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_nafath_requests_status"
          CHECK ("status" IN ('WAITING', 'COMPLETED', 'REJECTED', 'EXPIRED', 'FAILED')),
        CONSTRAINT "CHK_nafath_requests_statusSource"
          CHECK ("statusSource" IS NULL OR "statusSource" IN ('callback', 'poll'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_nafath_requests_nationalId_createdAt" ON "nafath_requests" ("nationalId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_nafath_requests_status_expiresAt" ON "nafath_requests" ("status", "expiresAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_nafath_requests_createdAt" ON "nafath_requests" ("createdAt")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "nafath_requests"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "UQ_users_nationalId"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "nafathVerifiedAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "nationalId"`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/migration-tests/nafath-login-migration.spec.ts`
Expected: PASS (3 tests).

Optional (if a local DB is available): `npm run docker:db`, then `DB_HOST=localhost npm run migration:run` → expect `AddNafathLogin1790985600000 has been executed successfully`, then `DB_HOST=localhost npm run migration:revert` and `migration:run` again to check `down()`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/nafath/entities/nafath-request.entity.ts src/modules/users/entities/user.entity.ts src/migrations/1790985600000-AddNafathLogin.ts src/migration-tests/nafath-login-migration.spec.ts
git commit -m "feat(nafath): add nafath_requests table and user nationalId columns"
```

---

### Task 6: `NafathService.start`

**Files:**
- Create: `src/modules/nafath/nafath.service.ts`
- Test: `src/modules/nafath/nafath.service.spec.ts`

**Interfaces:**
- Consumes: `NafathClient.createRequest` (Task 2), `NafathJwtVerifier` (Task 3), `NafathLinkTokenService` (Task 4), `NafathRequest`/`NafathRequestStatus`/`User` (Task 5), `AuthService.generateToken(user: User): string` and `AuthService.sanitize(user: User): Partial<User>` (existing), `toHttpError`/`nafathError`/`NafathApiError` (Task 1)
- Produces:
  - Constructor order (later tasks' tests rely on it): `(requestsRepo, usersRepo, dataSource, client, verifier, linkTokens, auth, config)`
  - `start(nationalId: string, lang: 'ar' | 'en' | undefined, clientIp: string): Promise<{ requestId: string; random: string; expiresAt: Date }>`
  - private helpers used by later tasks: `assertEnabled(): void`, `staleAt(row: NafathRequest): number`, `finish(id, status, source, claims): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

`src/modules/nafath/nafath.service.spec.ts`:

```ts
/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { NafathConfig } from './nafath.config';
import { NafathApiError } from './nafath.errors';
import { NafathService } from './nafath.service';
import { NafathRequest, NafathRequestStatus } from './entities/nafath-request.entity';

const NATIONAL_ID = '1000000001';

function makeService(overrides: Partial<NafathConfig> = {}) {
  const requestsRepo = {
    create: jest.fn((x: unknown) => x),
    save: jest.fn(async (x: unknown) => x),
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    count: jest.fn().mockResolvedValue(0),
  };
  const usersRepo = { findOne: jest.fn(), update: jest.fn().mockResolvedValue({ affected: 1 }) };
  const dataSource = { transaction: jest.fn() };
  const client = { createRequest: jest.fn(), getStatus: jest.fn() };
  const verifier = { verify: jest.fn() };
  const linkTokens = { sign: jest.fn().mockReturnValue('link-token'), verify: jest.fn() };
  const auth = {
    generateToken: jest.fn().mockReturnValue('aqar-jwt'),
    sanitize: jest.fn((u: unknown) => u),
  };
  const config = {
    enabled: true,
    service: 'Login',
    locale: 'ar',
    decisionSeconds: 60,
    graceSeconds: 20,
    ...overrides,
  } as NafathConfig;

  const service = new NafathService(
    requestsRepo as never,
    usersRepo as never,
    dataSource as never,
    client as never,
    verifier as never,
    linkTokens as never,
    auth as never,
    config,
  );
  return { service, requestsRepo, usersRepo, dataSource, client, verifier, linkTokens, auth };
}

function makeRow(overrides: Partial<NafathRequest> = {}): NafathRequest {
  const now = Date.now();
  return {
    id: '2b1f8c1e-7d1a-4c5e-9a39-0f1c2d3e4f50',
    nationalId: NATIONAL_ID,
    transId: 't-1',
    random: '80',
    service: 'Login',
    status: NafathRequestStatus.WAITING,
    statusSource: null,
    claims: null,
    clientIp: '5.5.5.5',
    expiresAt: new Date(now + 60_000),
    lastPolledAt: null,
    completedAt: null,
    consumedAt: null,
    linkedUserId: null,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    ...overrides,
  };
}

describe('NafathService.start', () => {
  it('creates a request row, calls Nafath and returns requestId/random/expiresAt', async () => {
    const { service, requestsRepo, client } = makeService();
    requestsRepo.findOne.mockResolvedValue(null);
    client.createRequest.mockResolvedValue({ transId: 't-1', random: '80' });

    const result = await service.start(NATIONAL_ID, 'en', '5.5.5.5');

    const saved = requestsRepo.save.mock.calls[0][0] as NafathRequest;
    expect(saved).toMatchObject({
      nationalId: NATIONAL_ID,
      service: 'Login',
      status: NafathRequestStatus.WAITING,
      clientIp: '5.5.5.5',
    });
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved.expiresAt.getTime() - Date.now()).toBeGreaterThan(55_000);
    expect(client.createRequest).toHaveBeenCalledWith({
      nationalId: NATIONAL_ID,
      service: 'Login',
      locale: 'en',
      requestId: saved.id,
      clientIp: '5.5.5.5',
    });
    expect(requestsRepo.update).toHaveBeenCalledWith(saved.id, { transId: 't-1', random: '80' });
    expect(result).toEqual({ requestId: saved.id, random: '80', expiresAt: saved.expiresAt });
  });

  it('uses the configured locale when none is given', async () => {
    const { service, requestsRepo, client } = makeService({ locale: 'ar' });
    requestsRepo.findOne.mockResolvedValue(null);
    client.createRequest.mockResolvedValue({ transId: 't-1', random: '80' });

    await service.start(NATIONAL_ID, undefined, '5.5.5.5');
    expect(client.createRequest).toHaveBeenCalledWith(expect.objectContaining({ locale: 'ar' }));
  });

  it('returns 409 without calling Nafath while a local request is still open', async () => {
    const { service, requestsRepo, client } = makeService();
    requestsRepo.findOne.mockResolvedValue(makeRow());

    await expect(service.start(NATIONAL_ID, undefined, '5.5.5.5')).rejects.toThrow(ConflictException);
    expect(client.createRequest).not.toHaveBeenCalled();
    expect(requestsRepo.save).not.toHaveBeenCalled();
  });

  it('ignores a stale WAITING row past expiry + grace', async () => {
    const { service, requestsRepo, client } = makeService();
    requestsRepo.findOne.mockResolvedValue(makeRow({ expiresAt: new Date(Date.now() - 21_000) }));
    client.createRequest.mockResolvedValue({ transId: 't-2', random: '12' });

    await expect(service.start(NATIONAL_ID, undefined, '5.5.5.5')).resolves.toMatchObject({ random: '12' });
  });

  it('marks the row FAILED and maps upstream 400-034-050 to 409', async () => {
    const { service, requestsRepo, client } = makeService();
    requestsRepo.findOne.mockResolvedValue(null);
    client.createRequest.mockRejectedValue(new NafathApiError(400, '400-034-050', 77, 'active'));

    await expect(service.start(NATIONAL_ID, undefined, '5.5.5.5')).rejects.toThrow(ConflictException);
    const saved = requestsRepo.save.mock.calls[0][0] as NafathRequest;
    expect(requestsRepo.update).toHaveBeenCalledWith(saved.id, {
      status: NafathRequestStatus.FAILED,
      completedAt: expect.any(Date),
    });
  });

  it('maps outages to 503', async () => {
    const { service, requestsRepo, client } = makeService();
    requestsRepo.findOne.mockResolvedValue(null);
    client.createRequest.mockRejectedValue(new NafathApiError(0, null, null, 'timeout'));

    await expect(service.start(NATIONAL_ID, undefined, '5.5.5.5')).rejects.toThrow(ServiceUnavailableException);
  });

  it('refuses to run when Nafath is disabled', async () => {
    const { service, requestsRepo } = makeService({ enabled: false });
    await expect(service.start(NATIONAL_ID, undefined, '5.5.5.5')).rejects.toThrow(ServiceUnavailableException);
    expect(requestsRepo.findOne).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/nafath/nafath.service.spec.ts`
Expected: FAIL — `Cannot find module './nafath.service'`.

- [ ] **Step 3: Implement**

`src/modules/nafath/nafath.service.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { User } from '../users/entities/user.entity';
import {
  NafathRequest,
  NafathRequestStatus,
  NafathStatusSource,
} from './entities/nafath-request.entity';
import { NafathClient } from './nafath.client';
import { NAFATH_CONFIG, NafathConfig } from './nafath.config';
import { NafathApiError, nafathError, toHttpError } from './nafath.errors';
import { NafathJwtVerifier } from './nafath-jwt.verifier';
import { NafathLinkTokenService } from './nafath-link-token.service';

@Injectable()
export class NafathService {
  private readonly logger = new Logger(NafathService.name);

  constructor(
    @InjectRepository(NafathRequest)
    private readonly requestsRepo: Repository<NafathRequest>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly client: NafathClient,
    private readonly verifier: NafathJwtVerifier,
    private readonly linkTokens: NafathLinkTokenService,
    private readonly auth: AuthService,
    @Inject(NAFATH_CONFIG) private readonly config: NafathConfig,
  ) {}

  async start(
    nationalId: string,
    lang: 'ar' | 'en' | undefined,
    clientIp: string,
  ): Promise<{ requestId: string; random: string; expiresAt: Date }> {
    this.assertEnabled();

    const open = await this.requestsRepo.findOne({
      where: { nationalId, status: NafathRequestStatus.WAITING },
      order: { createdAt: 'DESC' },
    });
    if (open && Date.now() < this.staleAt(open)) throw nafathError.pending();

    const row = this.requestsRepo.create({
      id: randomUUID(),
      nationalId,
      service: this.config.service,
      status: NafathRequestStatus.WAITING,
      clientIp,
      expiresAt: new Date(Date.now() + this.config.decisionSeconds * 1000),
    });
    await this.requestsRepo.save(row);

    try {
      const { transId, random } = await this.client.createRequest({
        nationalId,
        service: this.config.service,
        locale: lang ?? this.config.locale,
        requestId: row.id,
        clientIp,
      });
      await this.requestsRepo.update(row.id, { transId, random });
      return { requestId: row.id, random, expiresAt: row.expiresAt };
    } catch (err) {
      await this.requestsRepo.update(row.id, {
        status: NafathRequestStatus.FAILED,
        completedAt: new Date(),
      });
      this.logUpstreamError('start', row.id, err);
      throw toHttpError(err);
    }
  }

  private assertEnabled(): void {
    if (!this.config.enabled) throw nafathError.disabled();
  }

  /** Epoch ms after which a WAITING row is treated as expired. */
  private staleAt(row: NafathRequest): number {
    return row.expiresAt.getTime() + this.config.graceSeconds * 1000;
  }

  /** Move a WAITING row to a terminal status. Returns false if it was already terminal. */
  private async finish(
    id: string,
    status: NafathRequestStatus,
    source: NafathStatusSource | null,
    claims: Record<string, unknown> | null,
  ): Promise<boolean> {
    const res = await this.requestsRepo.update(
      { id, status: NafathRequestStatus.WAITING },
      { status, statusSource: source, completedAt: new Date(), claims },
    );
    return (res.affected ?? 0) > 0;
  }

  private logUpstreamError(op: string, requestId: string, err: unknown): void {
    if (err instanceof NafathApiError) {
      const hint = err.httpStatus === 403 ? ' (check APP-ID/APP-KEY for this environment)' : '';
      this.logger.error(
        `Nafath ${op} failed requestId=${requestId} http=${err.httpStatus} code=${err.code} ref=${err.reference}${hint}`,
      );
    } else {
      this.logger.error(`Nafath ${op} failed requestId=${requestId}: ${(err as Error).message}`);
    }
  }
}
```

Note: `usersRepo`, `dataSource`, `verifier`, `linkTokens`, `auth` and `finish` are used by Tasks 7–9. If ESLint flags them as unused in this task, leave them — the next task uses them.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/modules/nafath/nafath.service.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/nafath/nafath.service.ts src/modules/nafath/nafath.service.spec.ts
git commit -m "feat(nafath): start Nafath login requests"
```

---

### Task 7: `NafathService.getStatus` (lazy expiry, fallback poll, redemption)

**Files:**
- Modify: `src/modules/nafath/nafath.service.ts`
- Modify: `src/modules/nafath/nafath.service.spec.ts` (append a `describe` block; `makeService`/`makeRow` already exist from Task 6)

**Interfaces:**
- Consumes: `NafathClient.getStatus` (Task 2), `NafathLinkTokenService.sign` (Task 4), `AuthService.generateToken` / `sanitize`
- Produces:
  - ```ts
    export type NafathStatusResponse =
      | { status: 'WAITING'; expiresAt: Date }
      | {
      status: NafathRequestStatus.REJECTED | NafathRequestStatus.EXPIRED | NafathRequestStatus.FAILED;
    }
      | { status: 'COMPLETED'; token: string; isNewUser: false; user: Partial<User> }
      | { status: 'COMPLETED'; linkRequired: true; linkToken: string };
    ```
  - `getStatus(requestId: string): Promise<NafathStatusResponse>`
  - `parseTerminalStatus(value: unknown): NafathRequestStatus | null` (module-level function in `nafath.service.ts`, reused by Task 8)

- [ ] **Step 1: Write the failing tests**

Add these imports at the top of `nafath.service.spec.ts` (merge with the existing `@nestjs/common` import):

```ts
import { ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
```

Append:

```ts
describe('NafathService.getStatus', () => {
  const linkedUser = { id: 'user-1', phone: '+966500000001', role: 'USER', isActive: true };

  it('404s for an unknown request', async () => {
    const { service, requestsRepo } = makeService();
    requestsRepo.findOne.mockResolvedValue(null);
    await expect(service.getStatus('missing')).rejects.toThrow(NotFoundException);
  });

  it('returns WAITING without polling during the first 10 seconds', async () => {
    const { service, requestsRepo, client } = makeService();
    const row = makeRow();
    requestsRepo.findOne.mockResolvedValue(row);

    await expect(service.getStatus(row.id)).resolves.toEqual({ status: 'WAITING', expiresAt: row.expiresAt });
    expect(client.getStatus).not.toHaveBeenCalled();
  });

  it('expires a WAITING row past expiry + grace', async () => {
    const { service, requestsRepo, client } = makeService();
    const row = makeRow({ expiresAt: new Date(Date.now() - 21_000), createdAt: new Date(Date.now() - 81_000) });
    requestsRepo.findOne.mockResolvedValue(row);

    await expect(service.getStatus(row.id)).resolves.toEqual({ status: 'EXPIRED' });
    expect(requestsRepo.update).toHaveBeenCalledWith(
      { id: row.id, status: NafathRequestStatus.WAITING },
      expect.objectContaining({ status: NafathRequestStatus.EXPIRED }),
    );
    expect(client.getStatus).not.toHaveBeenCalled();
  });

  it('polls Nafath after 10 s and logs a linked user in on COMPLETED', async () => {
    const { service, requestsRepo, usersRepo, client, auth } = makeService();
    const row = makeRow({ createdAt: new Date(Date.now() - 15_000) });
    requestsRepo.findOne
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce({ ...row, status: NafathRequestStatus.COMPLETED, statusSource: 'poll' });
    client.getStatus.mockResolvedValue('COMPLETED');
    usersRepo.findOne.mockResolvedValue(linkedUser);

    const result = await service.getStatus(row.id);

    expect(client.getStatus).toHaveBeenCalledWith({
      nationalId: NATIONAL_ID,
      transId: 't-1',
      random: '80',
      clientIp: '5.5.5.5',
    });
    expect(requestsRepo.update).toHaveBeenCalledWith(row.id, { lastPolledAt: expect.any(Date) });
    expect(requestsRepo.update).toHaveBeenCalledWith(
      { id: row.id, status: NafathRequestStatus.WAITING },
      expect.objectContaining({ status: NafathRequestStatus.COMPLETED, statusSource: 'poll' }),
    );
    expect(usersRepo.findOne).toHaveBeenCalledWith({ where: { nationalId: NATIONAL_ID } });
    expect(usersRepo.update).toHaveBeenCalledWith('user-1', { nafathVerifiedAt: expect.any(Date) });
    expect(auth.generateToken).toHaveBeenCalledWith(linkedUser);
    expect(result).toEqual({ status: 'COMPLETED', token: 'aqar-jwt', isNewUser: false, user: linkedUser });
  });

  it('does not poll again within 5 s of the last poll', async () => {
    const { service, requestsRepo, client } = makeService();
    requestsRepo.findOne.mockResolvedValue(
      makeRow({ createdAt: new Date(Date.now() - 15_000), lastPolledAt: new Date(Date.now() - 2_000) }),
    );

    await expect(service.getStatus('id')).resolves.toMatchObject({ status: 'WAITING' });
    expect(client.getStatus).not.toHaveBeenCalled();
  });

  it('treats upstream 400-034-051 as EXPIRED', async () => {
    const { service, requestsRepo, client } = makeService();
    const row = makeRow({ createdAt: new Date(Date.now() - 15_000) });
    requestsRepo.findOne
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce({ ...row, status: NafathRequestStatus.EXPIRED });
    client.getStatus.mockRejectedValue(new NafathApiError(400, '400-034-051', 1, 'expired'));

    await expect(service.getStatus(row.id)).resolves.toEqual({ status: 'EXPIRED' });
  });

  it('keeps WAITING when polling fails for other reasons', async () => {
    const { service, requestsRepo, client } = makeService();
    requestsRepo.findOne.mockResolvedValue(makeRow({ createdAt: new Date(Date.now() - 15_000) }));
    client.getStatus.mockRejectedValue(new NafathApiError(0, null, null, 'timeout'));

    await expect(service.getStatus('id')).resolves.toMatchObject({ status: 'WAITING' });
  });

  it('returns a link token when no user has this national ID', async () => {
    const { service, requestsRepo, usersRepo, linkTokens } = makeService();
    const row = makeRow({ status: NafathRequestStatus.COMPLETED });
    requestsRepo.findOne.mockResolvedValue(row);
    usersRepo.findOne.mockResolvedValue(null);

    await expect(service.getStatus(row.id)).resolves.toEqual({
      status: 'COMPLETED',
      linkRequired: true,
      linkToken: 'link-token',
    });
    expect(linkTokens.sign).toHaveBeenCalledWith(row.id);
  });

  it('redeems a COMPLETED result only once (concurrent polls)', async () => {
    const { service, requestsRepo } = makeService();
    requestsRepo.findOne.mockResolvedValue(makeRow({ status: NafathRequestStatus.COMPLETED }));
    requestsRepo.update.mockResolvedValue({ affected: 0 });

    await expect(service.getStatus('id')).rejects.toThrow(GoneException);
  });

  it('refuses inactive accounts', async () => {
    const { service, requestsRepo, usersRepo, auth } = makeService();
    requestsRepo.findOne.mockResolvedValue(makeRow({ status: NafathRequestStatus.COMPLETED }));
    usersRepo.findOne.mockResolvedValue({ ...linkedUser, isActive: false });

    await expect(service.getStatus('id')).rejects.toThrow(ForbiddenException);
    expect(auth.generateToken).not.toHaveBeenCalled();
  });

  it('passes REJECTED and FAILED through', async () => {
    const { service, requestsRepo } = makeService();
    requestsRepo.findOne.mockResolvedValueOnce(makeRow({ status: NafathRequestStatus.REJECTED }));
    await expect(service.getStatus('id')).resolves.toEqual({ status: 'REJECTED' });

    requestsRepo.findOne.mockResolvedValueOnce(makeRow({ status: NafathRequestStatus.FAILED }));
    await expect(service.getStatus('id')).resolves.toEqual({ status: 'FAILED' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/modules/nafath/nafath.service.spec.ts -t getStatus`
Expected: FAIL — `service.getStatus is not a function`.

- [ ] **Step 3: Implement**

In `nafath.service.ts`, change the typeorm import to `import { DataSource, IsNull, Repository } from 'typeorm';` and add `NAFATH_CODES` to the errors import. Add above the class:

```ts
export type NafathStatusResponse =
  | { status: 'WAITING'; expiresAt: Date }
  | {
      status: NafathRequestStatus.REJECTED | NafathRequestStatus.EXPIRED | NafathRequestStatus.FAILED;
    }
  | { status: 'COMPLETED'; token: string; isNewUser: false; user: Partial<User> }
  | { status: 'COMPLETED'; linkRequired: true; linkToken: string };

const POLL_AFTER_MS = 10_000;
const POLL_EVERY_MS = 5_000;

export function parseTerminalStatus(value: unknown): NafathRequestStatus | null {
  switch (value) {
    case 'COMPLETED':
      return NafathRequestStatus.COMPLETED;
    case 'REJECTED':
      return NafathRequestStatus.REJECTED;
    case 'EXPIRED':
      return NafathRequestStatus.EXPIRED;
    default:
      return null;
  }
}
```

Add these methods to the class (public method after `start`, private ones next to the other helpers):

```ts
  async getStatus(requestId: string): Promise<NafathStatusResponse> {
    this.assertEnabled();

    let row = await this.requestsRepo.findOne({ where: { id: requestId } });
    if (!row) throw nafathError.notFound();

    if (row.status === NafathRequestStatus.WAITING && Date.now() >= this.staleAt(row)) {
      await this.finish(row.id, NafathRequestStatus.EXPIRED, null, null);
      row = { ...row, status: NafathRequestStatus.EXPIRED };
    }

    if (row.status === NafathRequestStatus.WAITING && this.shouldPoll(row)) {
      row = await this.pollUpstream(row);
    }

    switch (row.status) {
      case NafathRequestStatus.WAITING:
        return { status: 'WAITING', expiresAt: row.expiresAt };
      case NafathRequestStatus.COMPLETED:
        return this.redeem(row);
      default:
        return { status: row.status };
    }
  }

  private shouldPoll(row: NafathRequest): boolean {
    const now = Date.now();
    return (
      !!row.transId &&
      !!row.random &&
      now - row.createdAt.getTime() >= POLL_AFTER_MS &&
      (!row.lastPolledAt || now - row.lastPolledAt.getTime() >= POLL_EVERY_MS)
    );
  }

  /** Fallback when the callback is late or never arrives. Server-to-server, so trusted. */
  private async pollUpstream(row: NafathRequest): Promise<NafathRequest> {
    await this.requestsRepo.update(row.id, { lastPolledAt: new Date() });

    let terminal: NafathRequestStatus | null = null;
    try {
      terminal = parseTerminalStatus(
        await this.client.getStatus({
          nationalId: row.nationalId,
          transId: row.transId as string,
          random: row.random as string,
          clientIp: row.clientIp,
        }),
      );
    } catch (err) {
      if (
        err instanceof NafathApiError &&
        (err.code === NAFATH_CODES.TRX_EXPIRED || err.code === NAFATH_CODES.TRX_NOT_FOUND)
      ) {
        terminal = NafathRequestStatus.EXPIRED;
      } else {
        this.logUpstreamError('status poll', row.id, err);
        return row;
      }
    }

    if (!terminal) return row;
    await this.finish(row.id, terminal, 'poll', null);
    // Reload: the callback may have won the race and set the status first.
    return (await this.requestsRepo.findOne({ where: { id: row.id } })) ?? row;
  }

  private async redeem(row: NafathRequest): Promise<NafathStatusResponse> {
    const claimed = await this.requestsRepo.update(
      { id: row.id, consumedAt: IsNull() },
      { consumedAt: new Date() },
    );
    if (!claimed.affected) throw nafathError.alreadyUsed();

    const user = await this.usersRepo.findOne({ where: { nationalId: row.nationalId } });
    if (!user) {
      return { status: 'COMPLETED', linkRequired: true, linkToken: this.linkTokens.sign(row.id) };
    }
    if (!user.isActive) throw nafathError.accountInactive();

    await this.usersRepo.update(user.id, { nafathVerifiedAt: new Date() });
    return {
      status: 'COMPLETED',
      token: this.auth.generateToken(user),
      isNewUser: false,
      user: this.auth.sanitize(user),
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/modules/nafath/nafath.service.spec.ts`
Expected: PASS (all `start` and `getStatus` tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/nafath/nafath.service.ts src/modules/nafath/nafath.service.spec.ts
git commit -m "feat(nafath): status polling with fallback and single-use redemption"
```

---

### Task 8: `NafathService.handleCallback`

**Files:**
- Create: `src/modules/nafath/dto/nafath-callback.dto.ts`
- Modify: `src/modules/nafath/nafath.service.ts`
- Modify: `src/modules/nafath/nafath.service.spec.ts` (append)

**Interfaces:**
- Consumes: `NafathJwtVerifier.verify` (Task 3), `parseTerminalStatus`, `finish` (Tasks 6–7), `NafathTokenError`, `NafathApiError`
- Produces:
  - `class NafathCallbackDto { token: string; transId: string; requestId: string }` (class-validator decorated; used by the controller in Task 10)
  - `handleCallback(body: NafathCallbackDto): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Add imports at the top of `nafath.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { NafathTokenError } from './nafath.errors';
```

Append:

```ts
describe('NafathService.handleCallback', () => {
  const body = { token: 'jwt', transId: 't-1', requestId: '2b1f8c1e-7d1a-4c5e-9a39-0f1c2d3e4f50' };
  const completedPayload = { aud: 'AQAR', transId: 't-1', status: 'COMPLETED', nin: NATIONAL_ID };

  it('rejects tokens that fail verification with 400', async () => {
    const { service, verifier, requestsRepo } = makeService();
    verifier.verify.mockRejectedValue(new NafathTokenError('bad signature'));

    await expect(service.handleCallback(body)).rejects.toThrow(BadRequestException);
    expect(requestsRepo.update).not.toHaveBeenCalled();
  });

  it('returns 503 when the JWKS cannot be fetched (so Nafath can retry)', async () => {
    const { service, verifier } = makeService();
    verifier.verify.mockRejectedValue(new NafathApiError(503, null, null, 'down'));

    await expect(service.handleCallback(body)).rejects.toThrow(ServiceUnavailableException);
  });

  it('rejects a JWT whose transId differs from the body', async () => {
    const { service, verifier } = makeService();
    verifier.verify.mockResolvedValue({ ...completedPayload, transId: 'other' });

    await expect(service.handleCallback(body)).rejects.toThrow(BadRequestException);
  });

  it('acknowledges unknown requestIds without updating anything', async () => {
    const { service, verifier, requestsRepo } = makeService();
    verifier.verify.mockResolvedValue(completedPayload);
    requestsRepo.findOne.mockResolvedValue(null);

    await expect(service.handleCallback(body)).resolves.toBeUndefined();
    expect(requestsRepo.update).not.toHaveBeenCalled();
  });

  it('rejects a callback whose transId does not match our row', async () => {
    const { service, verifier, requestsRepo } = makeService();
    verifier.verify.mockResolvedValue(completedPayload);
    requestsRepo.findOne.mockResolvedValue(makeRow({ transId: 'different' }));

    await expect(service.handleCallback(body)).rejects.toThrow(BadRequestException);
  });

  it('records COMPLETED with claims, taking status from the JWT', async () => {
    const { service, verifier, requestsRepo } = makeService();
    verifier.verify.mockResolvedValue(completedPayload);
    requestsRepo.findOne.mockResolvedValue(makeRow());

    await service.handleCallback(body);

    expect(requestsRepo.update).toHaveBeenCalledWith(
      { id: body.requestId, status: NafathRequestStatus.WAITING },
      {
        status: NafathRequestStatus.COMPLETED,
        statusSource: 'callback',
        completedAt: expect.any(Date),
        claims: completedPayload,
      },
    );
  });

  it('back-fills claims when polling already marked the row COMPLETED', async () => {
    const { service, verifier, requestsRepo } = makeService();
    verifier.verify.mockResolvedValue(completedPayload);
    requestsRepo.findOne.mockResolvedValue(makeRow({ status: NafathRequestStatus.COMPLETED, statusSource: 'poll' }));
    requestsRepo.update.mockResolvedValueOnce({ affected: 0 }).mockResolvedValueOnce({ affected: 1 });

    await expect(service.handleCallback(body)).resolves.toBeUndefined();
    expect(requestsRepo.update).toHaveBeenLastCalledWith(
      { id: body.requestId, status: NafathRequestStatus.COMPLETED, claims: IsNull() },
      { claims: completedPayload },
    );
  });

  it('records REJECTED without claims', async () => {
    const { service, verifier, requestsRepo } = makeService();
    verifier.verify.mockResolvedValue({ ...completedPayload, status: 'REJECTED' });
    requestsRepo.findOne.mockResolvedValue(makeRow());

    await service.handleCallback(body);
    expect(requestsRepo.update).toHaveBeenCalledWith(
      { id: body.requestId, status: NafathRequestStatus.WAITING },
      expect.objectContaining({ status: NafathRequestStatus.REJECTED, claims: null }),
    );
  });

  it('ignores a non-terminal status in the JWT', async () => {
    const { service, verifier, requestsRepo } = makeService();
    verifier.verify.mockResolvedValue({ ...completedPayload, status: 'WAITING' });
    requestsRepo.findOne.mockResolvedValue(makeRow());

    await expect(service.handleCallback(body)).resolves.toBeUndefined();
    expect(requestsRepo.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/modules/nafath/nafath.service.spec.ts -t handleCallback`
Expected: FAIL — `service.handleCallback is not a function`.

- [ ] **Step 3: Implement**

`src/modules/nafath/dto/nafath-callback.dto.ts`:

```ts
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

/** Body Nafath POSTs to our callback. Validated leniently in the controller (extra fields allowed). */
export class NafathCallbackDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @IsNotEmpty()
  transId!: string;

  @IsUUID()
  requestId!: string;
}
```

In `nafath.service.ts` add imports `NafathTokenError` (from `./nafath.errors`) and `NafathCallbackDto` (from `./dto/nafath-callback.dto`), plus `NafathTokenPayload` (from `./nafath-jwt.verifier`). Add the method:

```ts
  async handleCallback(body: NafathCallbackDto): Promise<void> {
    this.assertEnabled();

    let payload: NafathTokenPayload;
    try {
      payload = await this.verifier.verify(body.token);
    } catch (err) {
      if (err instanceof NafathTokenError) {
        this.logger.warn(`Nafath callback rejected transId=${body.transId}: ${err.message}`);
        throw nafathError.invalidToken();
      }
      this.logUpstreamError('callback key fetch', body.requestId, err);
      throw nafathError.unavailable();
    }

    if (payload.transId !== body.transId) {
      this.logger.warn(`Nafath callback transId mismatch requestId=${body.requestId}`);
      throw nafathError.invalidToken();
    }

    const row = await this.requestsRepo.findOne({ where: { id: body.requestId } });
    if (!row) {
      this.logger.warn(`Nafath callback for unknown requestId=${body.requestId}`);
      return;
    }
    if (row.transId !== body.transId) {
      this.logger.warn(`Nafath callback transId does not match requestId=${body.requestId}`);
      throw nafathError.invalidToken();
    }

    const status = parseTerminalStatus(payload.status);
    if (!status) {
      this.logger.warn(`Nafath callback with non-terminal status requestId=${body.requestId}`);
      return;
    }

    const claims = status === NafathRequestStatus.COMPLETED ? payload : null;
    const changed = await this.finish(row.id, status, 'callback', claims);

    if (!changed && claims) {
      // Polling (or an earlier callback) already set COMPLETED; keep the signed claims once.
      await this.requestsRepo.update(
        { id: row.id, status: NafathRequestStatus.COMPLETED, claims: IsNull() },
        { claims },
      );
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/modules/nafath/nafath.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/nafath/dto/nafath-callback.dto.ts src/modules/nafath/nafath.service.ts src/modules/nafath/nafath.service.spec.ts
git commit -m "feat(nafath): verify and record Nafath callbacks idempotently"
```

---

### Task 9: `NafathService.link`

**Files:**
- Modify: `src/modules/nafath/nafath.service.ts`
- Modify: `src/modules/nafath/nafath.service.spec.ts` (append)

**Interfaces:**
- Consumes: `NafathLinkTokenService.verify` (Task 4), `DataSource.transaction`, `AuthService.sanitize`
- Produces: `link(userId: string, linkToken: string): Promise<{ user: Partial<User> }>`

- [ ] **Step 1: Write the failing tests**

Add import at top of `nafath.service.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { User } from '../users/entities/user.entity';
```

Append:

```ts
describe('NafathService.link', () => {
  function setup() {
    const ctx = makeService();
    const txRequests = { findOne: jest.fn(), update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const txUsers = {
      findOne: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOneOrFail: jest.fn().mockResolvedValue({ id: 'user-1', isVerified: true }),
    };
    ctx.dataSource.transaction.mockImplementation(async (cb: (m: unknown) => unknown) =>
      cb({ getRepository: (entity: unknown) => (entity === User ? txUsers : txRequests) }),
    );
    ctx.linkTokens.verify.mockReturnValue('req-1');
    return { ...ctx, txRequests, txUsers };
  }

  const completedRow = () =>
    makeRow({ id: 'req-1', status: NafathRequestStatus.COMPLETED, consumedAt: new Date() });

  it('links the national ID to the current user', async () => {
    const { service, txRequests, txUsers } = setup();
    txRequests.findOne.mockResolvedValue(completedRow());
    txUsers.findOne.mockResolvedValue(null);

    await expect(service.link('user-1', 'link-token')).resolves.toEqual({
      user: { id: 'user-1', isVerified: true },
    });
    expect(txRequests.findOne).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(txUsers.update).toHaveBeenCalledWith('user-1', {
      nationalId: NATIONAL_ID,
      nafathVerifiedAt: expect.any(Date),
      isVerified: true,
    });
    expect(txRequests.update).toHaveBeenCalledWith('req-1', { linkedUserId: 'user-1' });
  });

  it('propagates an invalid link token as 401', async () => {
    const { service, linkTokens, dataSource } = setup();
    linkTokens.verify.mockImplementation(() => {
      throw new UnauthorizedException();
    });

    await expect(service.link('user-1', 'bad')).rejects.toThrow(UnauthorizedException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['not completed', makeRow({ id: 'req-1', status: NafathRequestStatus.WAITING })],
    ['not redeemed', makeRow({ id: 'req-1', status: NafathRequestStatus.COMPLETED, consumedAt: null })],
    ['already linked', makeRow({ id: 'req-1', status: NafathRequestStatus.COMPLETED, consumedAt: new Date(), linkedUserId: 'u-9' })],
  ])('rejects a request that is %s', async (_label, row) => {
    const { service, txRequests, txUsers } = setup();
    txRequests.findOne.mockResolvedValue(row);

    await expect(service.link('user-1', 'link-token')).rejects.toMatchObject({
      response: { error: 'NAFATH_LINK_INVALID' },
    });
    expect(txUsers.update).not.toHaveBeenCalled();
  });

  it('rejects when another account owns the national ID', async () => {
    const { service, txRequests, txUsers } = setup();
    txRequests.findOne.mockResolvedValue(completedRow());
    txUsers.findOne.mockResolvedValue({ id: 'someone-else' });

    await expect(service.link('user-1', 'link-token')).rejects.toMatchObject({
      response: { error: 'NAFATH_ID_LINKED_TO_OTHER_ACCOUNT' },
    });
  });

  it('rejects when the current account already has a different national ID', async () => {
    const { service, txRequests, txUsers } = setup();
    txRequests.findOne.mockResolvedValue(completedRow());
    txUsers.findOne.mockResolvedValue(null);
    txUsers.exists.mockResolvedValue(true);

    await expect(service.link('user-1', 'link-token')).rejects.toMatchObject({
      response: { error: 'NAFATH_ACCOUNT_HAS_OTHER_ID' },
    });
  });

  it('is idempotent when the current user already owns this national ID', async () => {
    const { service, txRequests, txUsers } = setup();
    txRequests.findOne.mockResolvedValue(completedRow());
    txUsers.findOne.mockResolvedValue({ id: 'user-1' });

    await expect(service.link('user-1', 'link-token')).resolves.toBeDefined();
    expect(txUsers.exists).not.toHaveBeenCalled();
  });

  it('maps a unique-constraint race to NAFATH_ID_LINKED_TO_OTHER_ACCOUNT', async () => {
    const { service, txRequests, txUsers } = setup();
    txRequests.findOne.mockResolvedValue(completedRow());
    txUsers.findOne.mockResolvedValue(null);
    txUsers.update.mockRejectedValue(Object.assign(new Error('duplicate'), { driverError: { code: '23505' } }));

    await expect(service.link('user-1', 'link-token')).rejects.toMatchObject({
      response: { error: 'NAFATH_ID_LINKED_TO_OTHER_ACCOUNT' },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/modules/nafath/nafath.service.spec.ts -t link`
Expected: FAIL — `service.link is not a function`.

- [ ] **Step 3: Implement**

In `nafath.service.ts` change the typeorm import to `import { DataSource, IsNull, Not, Repository } from 'typeorm';` and add:

```ts
function isUniqueViolation(err: unknown): boolean {
  return (err as { driverError?: { code?: string } })?.driverError?.code === '23505';
}
```

(module-level, below `parseTerminalStatus`). Add the method to the class:

```ts
  async link(userId: string, linkToken: string): Promise<{ user: Partial<User> }> {
    this.assertEnabled();
    const requestId = this.linkTokens.verify(linkToken);

    return this.dataSource.transaction(async (manager) => {
      const requests = manager.getRepository(NafathRequest);
      const users = manager.getRepository(User);

      const row = await requests.findOne({
        where: { id: requestId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !row ||
        row.status !== NafathRequestStatus.COMPLETED ||
        !row.consumedAt ||
        row.linkedUserId
      ) {
        throw nafathError.linkInvalid();
      }

      const owner = await users.findOne({ where: { nationalId: row.nationalId } });
      if (owner && owner.id !== userId) throw nafathError.idLinkedToOther();
      if (!owner) {
        const hasOtherId = await users.exists({ where: { id: userId, nationalId: Not(IsNull()) } });
        if (hasOtherId) throw nafathError.accountHasOtherId();
      }

      try {
        await users.update(userId, {
          nationalId: row.nationalId,
          nafathVerifiedAt: new Date(),
          isVerified: true,
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw nafathError.idLinkedToOther();
        throw err;
      }
      await requests.update(row.id, { linkedUserId: userId });

      const user = await users.findOneOrFail({ where: { id: userId } });
      return { user: this.auth.sanitize(user) };
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/modules/nafath/nafath.service.spec.ts`
Expected: PASS (all NafathService tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/nafath/nafath.service.ts src/modules/nafath/nafath.service.spec.ts
git commit -m "feat(nafath): link a Nafath-verified national ID to the OTP-authenticated account"
```

---

### Task 10: Guard, controllers, module wiring, `trust proxy`, env

**Files:**
- Create: `src/modules/nafath/nafath-ip.guard.ts`
- Create: `src/modules/nafath/dto/start-nafath.dto.ts`
- Create: `src/modules/nafath/dto/link-nafath.dto.ts`
- Create: `src/modules/nafath/nafath-auth.controller.ts`
- Create: `src/modules/nafath/nafath-callback.controller.ts`
- Create: `src/modules/nafath/nafath.module.ts`
- Modify: `src/app.module.ts` (import `NafathModule`)
- Modify: `src/main.ts` (typed Express app + `trust proxy`)
- Modify: `.env.example` (append Nafath vars)
- Test: `src/modules/nafath/nafath-ip.guard.spec.ts`
- Test: `src/modules/nafath/nafath-callback.controller.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–9
- Produces HTTP endpoints:
  - `POST /api/v1/auth/nafath/start` body `{ nationalId, lang? }`
  - `GET /api/v1/auth/nafath/status/:requestId`
  - `POST /api/v1/auth/nafath/link` (Bearer) body `{ linkToken }`
  - `POST /api/v1/nafath/callback` (IP allow-listed) — returns 200

- [ ] **Step 1: Write the failing tests**

`src/modules/nafath/nafath-ip.guard.spec.ts`:

```ts
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
    expect(() => guard.canActivate(contextFor('8.8.8.8'))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(ForbiddenException);
  });
});
```

`src/modules/nafath/nafath-callback.controller.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { NafathCallbackController } from './nafath-callback.controller';

describe('NafathCallbackController', () => {
  const valid = {
    token: 'jwt',
    transId: 't-1',
    requestId: '2b1f8c1e-7d1a-4c5e-9a39-0f1c2d3e4f50',
  };

  function make() {
    const service = { handleCallback: jest.fn().mockResolvedValue(undefined) };
    return { controller: new NafathCallbackController(service as never), service };
  }

  it('accepts bodies with extra fields Nafath may add', async () => {
    const { controller, service } = make();
    await expect(controller.callback({ ...valid, status: 'COMPLETED', extra: 1 })).resolves.toEqual({
      received: true,
    });
    expect(service.handleCallback).toHaveBeenCalledWith(expect.objectContaining(valid));
  });

  it('rejects bodies missing required fields or with a non-UUID requestId', async () => {
    const { controller, service } = make();
    await expect(controller.callback({ transId: 't-1', requestId: valid.requestId })).rejects.toThrow(
      BadRequestException,
    );
    await expect(controller.callback({ ...valid, requestId: 'not-a-uuid' })).rejects.toThrow(BadRequestException);
    expect(service.handleCallback).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/modules/nafath/nafath-ip.guard.spec.ts src/modules/nafath/nafath-callback.controller.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement guard, DTOs, controllers, module**

`src/modules/nafath/nafath-ip.guard.ts`:

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
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
```

`src/modules/nafath/dto/start-nafath.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class StartNafathDto {
  @ApiProperty({ example: '1000000001', description: 'National ID, Iqama, visa or border number' })
  @IsString()
  @Matches(/^[1-6]\d{9}$/, { message: 'nationalId must be 10 digits starting with 1-6' })
  nationalId!: string;

  @ApiPropertyOptional({ enum: ['ar', 'en'], description: 'Language of the Nafath user attributes' })
  @IsOptional()
  @IsIn(['ar', 'en'])
  lang?: 'ar' | 'en';
}
```

`src/modules/nafath/dto/link-nafath.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LinkNafathDto {
  @ApiProperty({ description: 'linkToken returned by GET /auth/nafath/status when linkRequired is true' })
  @IsString()
  @IsNotEmpty()
  linkToken!: string;
}
```

`src/modules/nafath/nafath-auth.controller.ts`:

```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { User } from '../users/entities/user.entity';
import { LinkNafathDto } from './dto/link-nafath.dto';
import { StartNafathDto } from './dto/start-nafath.dto';
import { normalizeIp } from './nafath-ip.util';
import { NafathService } from './nafath.service';

@ApiTags('Auth — Nafath')
@Controller('auth/nafath')
export class NafathAuthController {
  constructor(private readonly nafath: NafathService) {}

  @Public()
  @Post('start')
  @ApiOperation({ summary: 'Start a Nafath login — returns requestId and the number to show the user' })
  @ApiResponse({ status: 201, description: '{ requestId, random, expiresAt }' })
  start(@Body() dto: StartNafathDto, @Req() req: Request) {
    return this.nafath.start(dto.nationalId, dto.lang, normalizeIp(req.ip));
  }

  @Public()
  @Get('status/:requestId')
  @ApiOperation({ summary: 'Poll a Nafath login — returns a token or linkToken once COMPLETED' })
  status(@Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string) {
    return this.nafath.getStatus(requestId);
  }

  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @Post('link')
  @ApiOperation({ summary: 'Link a Nafath-verified national ID to the logged-in (OTP) account' })
  link(@GetUser() user: User, @Body() dto: LinkNafathDto) {
    return this.nafath.link(user.id, dto.linkToken);
  }
}
```

`src/modules/nafath/nafath-callback.controller.ts`:

```ts
import { BadRequestException, Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { NafathCallbackDto } from './dto/nafath-callback.dto';
import { NafathIpGuard } from './nafath-ip.guard';
import { NafathService } from './nafath.service';

@ApiExcludeController()
@Controller('nafath')
export class NafathCallbackController {
  constructor(private readonly nafath: NafathService) {}

  /**
   * Body is typed as a plain object on purpose: the global ValidationPipe
   * (forbidNonWhitelisted) skips non-class types, so extra fields Nafath may
   * add do not cause every callback to be rejected.
   */
  @Public()
  @UseGuards(NafathIpGuard)
  @Post('callback')
  @HttpCode(200)
  async callback(@Body() body: Record<string, unknown>): Promise<{ received: true }> {
    const dto = plainToInstance(NafathCallbackDto, body);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: false });
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Invalid Nafath callback body', error: 'NAFATH_INVALID_CALLBACK' });
    }
    await this.nafath.handleCallback(dto);
    return { received: true };
  }
}
```

`src/modules/nafath/nafath.module.ts`:

```ts
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
```

- [ ] **Step 4: Wire into the app**

`src/app.module.ts` — add `import { NafathModule } from './modules/nafath/nafath.module';` and add `NafathModule,` to `imports` right after `AuthModule,`.

`src/main.ts` — add `import { NestExpressApplication } from '@nestjs/platform-express';`, change creation and add `trust proxy` right after it:

```ts
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useWebSocketAdapter(new IoAdapter(app));

  // Real client IP for Nafath X-Forwarded-For, throttling and the callback IP allow-list.
  // TRUST_PROXY: hop count ("1"), "true", or a comma-separated list of proxy IPs/CIDRs.
  const trustProxy = process.env['TRUST_PROXY'];
  if (trustProxy) {
    app.set(
      'trust proxy',
      /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true' ? true : trustProxy,
    );
  }
```

`.env.example` — append:

```dotenv
TRUST_PROXY=
NAFATH_ENABLED=false
NAFATH_BASE_URL=https://rabet-nafath.api.elm.sa
NAFATH_APP_ID=
NAFATH_APP_KEY=
NAFATH_SERVICE=Login
NAFATH_AUDIENCE=
NAFATH_SERVER_IP=
NAFATH_CALLBACK_ALLOWED_IPS=195.170.180.7,195.170.180.6
NAFATH_LOCALE=ar
NAFATH_DECISION_SECONDS=60
NAFATH_GRACE_SECONDS=20
NAFATH_LINK_TOKEN_SECRET=
NAFATH_RETENTION_DAYS=30
```

- [ ] **Step 5: Run the new tests, the full suite, and the type-check**

Run: `npx jest src/modules/nafath/nafath-ip.guard.spec.ts src/modules/nafath/nafath-callback.controller.spec.ts`
Expected: PASS (4 tests).

Run: `npx jest`
Expected: all suites PASS (the 4 pre-existing suites plus the new Nafath ones).

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

Run: `npx eslint src/modules/nafath src/modules/auth/strategies src/main.ts src/app.module.ts`
Expected: no errors (fix any reported, e.g. unused imports).

- [ ] **Step 6: Boot check (needs a local DB)**

Run: `npm run docker:db`, then `DB_HOST=localhost NAFATH_ENABLED=false npm run start:dev`.
Expected: app boots, migration `AddNafathLogin1790985600000` runs, Swagger at `http://localhost:3000/api/docs` lists **Auth — Nafath** with `start`, `status/{requestId}`, `link`.
Then: `curl -s -X POST localhost:3000/api/v1/auth/nafath/start -H 'Content-Type: application/json' -d '{"nationalId":"1000000001"}'`
Expected: `{"success":false,"message":"Nafath login is not enabled","error":"NAFATH_DISABLED",...}` with HTTP 503.
And: `curl -s -X POST localhost:3000/api/v1/auth/nafath/start -H 'Content-Type: application/json' -d '{"nationalId":"99"}'`
Expected: HTTP 400 with the `nationalId must be 10 digits starting with 1-6` message.

- [ ] **Step 7: Commit**

```bash
git add src/modules/nafath src/app.module.ts src/main.ts .env.example
git commit -m "feat(nafath): expose Nafath login endpoints and callback"
```

**MVP complete at this point.**

---

### Task 11: Production smoke test (manual, on the KSA server)

No code. Run from the deployed backend: the egress IP must be the one registered with Elm, and the callback URL must be reachable from Nafath.

- [ ] **Step 1: Configure the environment**

Set on the server (test `api.test.aqora.sa` / prod `api.aqora.sa`): `NAFATH_ENABLED=true`, `NAFATH_BASE_URL=https://rabet-nafath.api.elm.sa`, the Rabet `NAFATH_APP_ID`/`NAFATH_APP_KEY`, `NAFATH_AUDIENCE=<SP name on Rabet>`, `NAFATH_SERVER_IP=<registered egress IP>`, `NAFATH_LINK_TOKEN_SECRET=<openssl rand -hex 32>`, `TRUST_PROXY=<hops to the app, e.g. 1>`. Restart.

- [ ] **Step 2: Happy path for a new national ID**

1. `POST /api/v1/auth/nafath/start {"nationalId":"<a consenting team member's national ID>"}` → expect `requestId`, `random`, `expiresAt`. If 503: check logs for `http=403` (credentials/egress IP) or `http=0` (network).
2. Approve in that person's Nafath app (production pushes to real devices).
3. Poll `GET /api/v1/auth/nafath/status/<requestId>` → expect `COMPLETED` + `linkRequired: true` + `linkToken`.
4. `POST /auth/send-otp` + `POST /auth/verify-otp` for a test phone → bearer token.
5. `POST /api/v1/auth/nafath/link {"linkToken":"..."}` with the bearer → expect `user` with `isVerified: true`.
6. Start again for the same ID, approve, poll → expect `COMPLETED` + `token` + `user` (one-step login).

- [ ] **Step 3: Inspect the callback and claims**

`SELECT "statusSource", jsonb_pretty(claims) FROM nafath_requests ORDER BY "createdAt" DESC LIMIT 2;`
Expected: `statusSource = 'callback'` (or `poll` with claims back-filled) and top-level identity claims. If `claims` is always null, look for `Rejected Nafath callback from <ip>` (fix `TRUST_PROXY`/firewall) or `Nafath callback rejected ... audience` (fix `NAFATH_AUDIENCE`). **Bring the claim layout back to decide which identity columns to store.**

- [ ] **Step 4: Edge paths**

Reject in the app → `REJECTED`. Let one expire → `EXPIRED` after ~80 s. Start twice quickly → second returns 409 `NAFATH_REQUEST_PENDING`. Poll a COMPLETED request twice → second returns 410.

---

### Task 12: Rate limiting on `start`

**Files:**
- Modify: `src/app.module.ts` (register `ThrottlerModule`)
- Modify: `src/modules/nafath/nafath-auth.controller.ts` (`start` route)
- Modify: `src/modules/nafath/nafath.service.ts` (`start`)
- Modify: `src/modules/nafath/nafath.service.spec.ts` (append)

**Interfaces:**
- Consumes: `nafathError.rateLimited()` (Task 1), `requestsRepo.count`
- Produces: per-IP limit 5/min on `POST /auth/nafath/start`; per-national-ID limit 5 per 10 min → 429 `NAFATH_RATE_LIMITED`

- [ ] **Step 1: Write the failing test**

Append to `nafath.service.spec.ts` (add `HttpException` to the `@nestjs/common` import and `MoreThan` from `typeorm`):

```ts
describe('NafathService.start rate limit', () => {
  it('rejects the 6th request for one national ID within 10 minutes', async () => {
    const { service, requestsRepo, client } = makeService();
    requestsRepo.findOne.mockResolvedValue(null);
    requestsRepo.count.mockResolvedValue(5);

    const err = await service.start(NATIONAL_ID, undefined, '5.5.5.5').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect(requestsRepo.count).toHaveBeenCalledWith({
      where: { nationalId: NATIONAL_ID, createdAt: MoreThan(expect.any(Date)) },
    });
    expect(client.createRequest).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/nafath/nafath.service.spec.ts -t "rate limit"`
Expected: FAIL — `createRequest` is called / no 429.

- [ ] **Step 3: Implement**

In `nafath.service.ts` add `MoreThan` to the typeorm import, add constants below `POLL_EVERY_MS`:

```ts
const PER_ID_WINDOW_MS = 10 * 60 * 1000;
const PER_ID_MAX_REQUESTS = 5;
```

In `start`, insert right after the `if (open && ...) throw nafathError.pending();` line:

```ts
    const recent = await this.requestsRepo.count({
      where: { nationalId, createdAt: MoreThan(new Date(Date.now() - PER_ID_WINDOW_MS)) },
    });
    if (recent >= PER_ID_MAX_REQUESTS) throw nafathError.rateLimited();
```

`src/app.module.ts` — add `import { ThrottlerModule } from '@nestjs/throttler';` and in `imports` after `ScheduleModule.forRoot(),`:

```ts
    // No global guard: only routes that opt in with ThrottlerGuard are limited.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),
```

`nafath-auth.controller.ts` — add `import { Throttle, ThrottlerGuard } from '@nestjs/throttler';` and decorate `start`:

```ts
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('start')
```

- [ ] **Step 4: Run tests**

Run: `npx jest` and `npx tsc --noEmit -p tsconfig.json`
Expected: all PASS, no type errors.
Manual (local, `NAFATH_ENABLED=false`): run the `start` curl from Task 10 six times within a minute → the 6th returns HTTP 429.

- [ ] **Step 5: Commit**

```bash
git add src/app.module.ts src/modules/nafath/nafath-auth.controller.ts src/modules/nafath/nafath.service.ts src/modules/nafath/nafath.service.spec.ts
git commit -m "feat(nafath): rate-limit login starts per IP and per national ID"
```

---

### Task 13: Scheduled expiry and retention cleanup

**Files:**
- Create: `src/modules/nafath/nafath.cron.ts`
- Modify: `src/modules/nafath/nafath.module.ts` (add `NafathCron` to `providers`)
- Test: `src/modules/nafath/nafath.cron.spec.ts`

**Interfaces:**
- Consumes: `NafathRequest`, `NafathRequestStatus` (Task 5), `NAFATH_CONFIG` (Task 1); `ScheduleModule.forRoot()` is already registered in `AppModule`
- Produces: `class NafathCron { expireStale(): Promise<void>; purgeOld(): Promise<void> }`

- [ ] **Step 1: Write the failing test**

`src/modules/nafath/nafath.cron.spec.ts`:

```ts
import { LessThan } from 'typeorm';
import { NafathRequestStatus } from './entities/nafath-request.entity';
import { NafathConfig } from './nafath.config';
import { NafathCron } from './nafath.cron';

describe('NafathCron', () => {
  const repo = {
    update: jest.fn().mockResolvedValue({ affected: 2 }),
    delete: jest.fn().mockResolvedValue({ affected: 3 }),
  };
  const cron = new NafathCron(repo as never, { graceSeconds: 20, retentionDays: 30 } as NafathConfig);

  beforeEach(() => jest.clearAllMocks());

  it('expires WAITING rows past expiry + grace', async () => {
    const before = Date.now();
    await cron.expireStale();

    const [where, set] = repo.update.mock.calls[0] as [
      { status: string; expiresAt: ReturnType<typeof LessThan> },
      { status: string; completedAt: Date },
    ];
    expect(where.status).toBe(NafathRequestStatus.WAITING);
    const cutoff = (where.expiresAt as unknown as { value: Date }).value.getTime();
    expect(before - cutoff).toBeGreaterThanOrEqual(20_000);
    expect(before - cutoff).toBeLessThan(21_000);
    expect(set).toEqual({ status: NafathRequestStatus.EXPIRED, completedAt: expect.any(Date) });
  });

  it('deletes rows older than the retention period', async () => {
    const before = Date.now();
    await cron.purgeOld();

    const [where] = repo.delete.mock.calls[0] as [{ createdAt: ReturnType<typeof LessThan> }];
    const cutoff = (where.createdAt as unknown as { value: Date }).value.getTime();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(before - cutoff).toBeGreaterThanOrEqual(thirtyDays);
    expect(before - cutoff).toBeLessThan(thirtyDays + 1_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/nafath/nafath.cron.spec.ts`
Expected: FAIL — `Cannot find module './nafath.cron'`.

- [ ] **Step 3: Implement**

`src/modules/nafath/nafath.cron.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { NafathRequest, NafathRequestStatus } from './entities/nafath-request.entity';
import { NAFATH_CONFIG, NafathConfig } from './nafath.config';

@Injectable()
export class NafathCron {
  private readonly logger = new Logger(NafathCron.name);

  constructor(
    @InjectRepository(NafathRequest)
    private readonly requestsRepo: Repository<NafathRequest>,
    @Inject(NAFATH_CONFIG) private readonly config: NafathConfig,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireStale(): Promise<void> {
    const cutoff = new Date(Date.now() - this.config.graceSeconds * 1000);
    const res = await this.requestsRepo.update(
      { status: NafathRequestStatus.WAITING, expiresAt: LessThan(cutoff) },
      { status: NafathRequestStatus.EXPIRED, completedAt: new Date() },
    );
    if (res.affected) this.logger.log(`Expired ${res.affected} stale Nafath request(s)`);
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeOld(): Promise<void> {
    const cutoff = new Date(Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000);
    const res = await this.requestsRepo.delete({ createdAt: LessThan(cutoff) });
    if (res.affected) this.logger.log(`Purged ${res.affected} Nafath request(s) past retention`);
  }
}
```

`src/modules/nafath/nafath.module.ts` — add `import { NafathCron } from './nafath.cron';` and `NafathCron,` to `providers`.

- [ ] **Step 4: Run tests**

Run: `npx jest` and `npx tsc --noEmit -p tsconfig.json`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/nafath/nafath.cron.ts src/modules/nafath/nafath.cron.spec.ts src/modules/nafath/nafath.module.ts
git commit -m "feat(nafath): expire stale requests and purge old rows on schedule"
```
