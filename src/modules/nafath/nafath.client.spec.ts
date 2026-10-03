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
    fetchMock.mockResolvedValue(
      jsonResponse(200, { transId: 't-1', random: '80' }),
    );

    const result = await client.createRequest({
      nationalId: '1000000001',
      service: 'Login',
      locale: 'en',
      requestId: 'r-1',
      clientIp: '5.5.5.5',
    });

    expect(result).toEqual({ transId: 't-1', random: '80' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://nafath.test/nafath-sandbox/api/v1/mfa/request?local=en&requestId=r-1',
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'APP-ID': 'APP',
      'APP-KEY': 'KEY',
      'X-Forwarded-For': '5.5.5.5,10.0.0.1',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      nationalId: '1000000001',
      service: 'Login',
    });
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
    expect(url).toBe(
      'https://nafath.test/nafath-sandbox/api/v1/mfa/request/status',
    );
    expect(JSON.parse(init.body as string)).toEqual({
      nationalId: '1000000001',
      transId: 't-1',
      random: '80',
    });
  });

  it('fetches the JWKS with GET and no body', async () => {
    const keys = [
      { kty: 'RSA', kid: 'k1', n: 'n', e: 'AQAB', alg: 'RS256', use: 'sig' },
    ];
    fetchMock.mockResolvedValue(jsonResponse(200, { keys }));

    await expect(client.getJwks()).resolves.toEqual(keys);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://nafath.test/nafath-sandbox/api/v1/mfa/jwk');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  describe('2xx response shape checks', () => {
    const createArgs = {
      nationalId: '1',
      service: 'Login',
      locale: 'ar' as const,
      requestId: 'r',
      clientIp: '5.5.5.5',
    };
    const statusArgs = {
      nationalId: '1',
      transId: 't',
      random: '1',
      clientIp: '5.5.5.5',
    };

    it.each([
      null,
      {},
      { transId: 't-1' },
      { random: '80' },
      { transId: 1, random: '80' },
    ])('createRequest rejects a malformed body %p', async (body) => {
      fetchMock.mockResolvedValue(jsonResponse(200, body));
      await expect(client.createRequest(createArgs)).rejects.toMatchObject({
        name: 'NafathApiError',
        httpStatus: 200,
        message: 'Malformed Nafath response',
      });
    });

    it.each([null, {}, { status: 1 }])(
      'getStatus rejects a malformed body %p',
      async (body) => {
        fetchMock.mockResolvedValue(jsonResponse(200, body));
        await expect(client.getStatus(statusArgs)).rejects.toMatchObject({
          name: 'NafathApiError',
          httpStatus: 200,
          message: 'Malformed Nafath response',
        });
      },
    );

    it.each([null, {}, { keys: 'nope' }])(
      'getJwks rejects a malformed body %p',
      async (body) => {
        fetchMock.mockResolvedValue(jsonResponse(200, body));
        await expect(client.getJwks()).rejects.toMatchObject({
          name: 'NafathApiError',
          httpStatus: 200,
          message: 'Malformed Nafath response',
        });
      },
    );
  });

  it('turns Nafath error bodies into NafathApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        status: '400',
        code: '400-034-050',
        message: 'Invalid Request, There Is Active Trx',
        reference: 77,
      }),
    );

    await expect(
      client.createRequest({
        nationalId: '1',
        service: 'Login',
        locale: 'ar',
        requestId: 'r',
        clientIp: '5.5.5.5',
      }),
    ).rejects.toMatchObject({
      name: 'NafathApiError',
      httpStatus: 400,
      code: '400-034-050',
      reference: 77,
    });
  });

  it('handles non-JSON error bodies', async () => {
    fetchMock.mockResolvedValue(
      new Response('Service Unavailable', { status: 503 }),
    );

    await expect(client.getJwks()).rejects.toMatchObject({
      httpStatus: 503,
      code: null,
      reference: null,
    });
  });

  it('wraps network failures with httpStatus 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const err = await client.getJwks().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NafathApiError);
    expect(err).toMatchObject({ httpStatus: 0 });
  });
});
