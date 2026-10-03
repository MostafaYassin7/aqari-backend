/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await */
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { NafathConfig } from './nafath.config';
import { NafathApiError } from './nafath.errors';
import { NafathService } from './nafath.service';
import {
  NafathRequest,
  NafathRequestStatus,
} from './entities/nafath-request.entity';

const NATIONAL_ID = '1000000001';

function makeService(overrides: Partial<NafathConfig> = {}) {
  const requestsRepo = {
    create: jest.fn((x: unknown) => x),
    save: jest.fn(async (x: unknown) => x),
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    count: jest.fn().mockResolvedValue(0),
  };
  const usersRepo = {
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const dataSource = { transaction: jest.fn() };
  const client = { createRequest: jest.fn(), getStatus: jest.fn() };
  const verifier = { verify: jest.fn() };
  const linkTokens = {
    sign: jest.fn().mockReturnValue('link-token'),
    verify: jest.fn(),
  };
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
  return {
    service,
    requestsRepo,
    usersRepo,
    dataSource,
    client,
    verifier,
    linkTokens,
    auth,
  };
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
    expect(requestsRepo.update).toHaveBeenCalledWith(saved.id, {
      transId: 't-1',
      random: '80',
    });
    expect(result).toEqual({
      requestId: saved.id,
      random: '80',
      expiresAt: saved.expiresAt,
    });
  });

  it('uses the configured locale when none is given', async () => {
    const { service, requestsRepo, client } = makeService({ locale: 'ar' });
    requestsRepo.findOne.mockResolvedValue(null);
    client.createRequest.mockResolvedValue({ transId: 't-1', random: '80' });

    await service.start(NATIONAL_ID, undefined, '5.5.5.5');
    expect(client.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'ar' }),
    );
  });

  it('returns 409 without calling Nafath while a local request is still open', async () => {
    const { service, requestsRepo, client } = makeService();
    requestsRepo.findOne.mockResolvedValue(makeRow());

    await expect(
      service.start(NATIONAL_ID, undefined, '5.5.5.5'),
    ).rejects.toThrow(ConflictException);
    expect(client.createRequest).not.toHaveBeenCalled();
    expect(requestsRepo.save).not.toHaveBeenCalled();
  });

  it('ignores a stale WAITING row past expiry + grace', async () => {
    const { service, requestsRepo, client } = makeService();
    requestsRepo.findOne.mockResolvedValue(
      makeRow({ expiresAt: new Date(Date.now() - 21_000) }),
    );
    client.createRequest.mockResolvedValue({ transId: 't-2', random: '12' });

    await expect(
      service.start(NATIONAL_ID, undefined, '5.5.5.5'),
    ).resolves.toMatchObject({ random: '12' });
  });

  it('marks the row FAILED and maps upstream 400-034-050 to 409', async () => {
    const { service, requestsRepo, client } = makeService();
    requestsRepo.findOne.mockResolvedValue(null);
    client.createRequest.mockRejectedValue(
      new NafathApiError(400, '400-034-050', 77, 'active'),
    );

    await expect(
      service.start(NATIONAL_ID, undefined, '5.5.5.5'),
    ).rejects.toThrow(ConflictException);
    const saved = requestsRepo.save.mock.calls[0][0] as NafathRequest;
    expect(requestsRepo.update).toHaveBeenCalledWith(saved.id, {
      status: NafathRequestStatus.FAILED,
      completedAt: expect.any(Date),
    });
  });

  it('maps outages to 503', async () => {
    const { service, requestsRepo, client } = makeService();
    requestsRepo.findOne.mockResolvedValue(null);
    client.createRequest.mockRejectedValue(
      new NafathApiError(0, null, null, 'timeout'),
    );

    await expect(
      service.start(NATIONAL_ID, undefined, '5.5.5.5'),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('refuses to run when Nafath is disabled', async () => {
    const { service, requestsRepo } = makeService({ enabled: false });
    await expect(
      service.start(NATIONAL_ID, undefined, '5.5.5.5'),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(requestsRepo.findOne).not.toHaveBeenCalled();
  });
});
