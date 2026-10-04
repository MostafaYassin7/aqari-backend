/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await */
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
import { IsNull, MoreThan } from 'typeorm';
import { NafathConfig } from './nafath.config';
import { NafathApiError, NafathTokenError } from './nafath.errors';
import { NafathService } from './nafath.service';
import {
  NafathRequest,
  NafathRequestStatus,
} from './entities/nafath-request.entity';
import { User } from '../users/entities/user.entity';

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
  const client = {
    createRequest: jest.fn(),
    getStatus: jest.fn(),
    createWebSession: jest.fn(),
    retrieveWebToken: jest.fn(),
  };
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

  describe('rate limit', () => {
    it('rejects the 6th request for one national ID within 10 minutes', async () => {
      const { service, requestsRepo, client } = makeService();
      requestsRepo.findOne.mockResolvedValue(null);
      requestsRepo.count.mockResolvedValue(5);

      const err = await service
        .start(NATIONAL_ID, undefined, '5.5.5.5')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
      expect(requestsRepo.count).toHaveBeenCalledWith({
        where: {
          nationalId: NATIONAL_ID,
          createdAt: MoreThan(expect.any(Date)),
        },
      });
      expect(client.createRequest).not.toHaveBeenCalled();
    });
  });
});

describe('NafathService.getStatus', () => {
  const linkedUser = {
    id: 'user-1',
    phone: '+966500000001',
    role: 'USER',
    isActive: true,
  };

  it('404s for an unknown request', async () => {
    const { service, requestsRepo } = makeService();
    requestsRepo.findOne.mockResolvedValue(null);
    await expect(service.getStatus('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns WAITING without polling during the first 10 seconds', async () => {
    const { service, requestsRepo, client } = makeService();
    const row = makeRow();
    requestsRepo.findOne.mockResolvedValue(row);

    await expect(service.getStatus(row.id)).resolves.toEqual({
      status: 'WAITING',
      expiresAt: row.expiresAt,
    });
    expect(client.getStatus).not.toHaveBeenCalled();
  });

  it('expires a WAITING row past expiry + grace', async () => {
    const { service, requestsRepo, client } = makeService();
    const row = makeRow({
      expiresAt: new Date(Date.now() - 21_000),
      createdAt: new Date(Date.now() - 81_000),
    });
    requestsRepo.findOne.mockResolvedValue(row);

    await expect(service.getStatus(row.id)).resolves.toEqual({
      status: 'EXPIRED',
    });
    expect(requestsRepo.update).toHaveBeenCalledWith(
      { id: row.id, status: NafathRequestStatus.WAITING },
      expect.objectContaining({ status: NafathRequestStatus.EXPIRED }),
    );
    expect(client.getStatus).not.toHaveBeenCalled();
  });

  it('polls Nafath after 10 s and logs a linked user in on COMPLETED', async () => {
    const { service, requestsRepo, usersRepo, client, auth } = makeService();
    const row = makeRow({ createdAt: new Date(Date.now() - 15_000) });
    requestsRepo.findOne.mockResolvedValueOnce(row).mockResolvedValueOnce({
      ...row,
      status: NafathRequestStatus.COMPLETED,
      statusSource: 'poll',
    });
    client.getStatus.mockResolvedValue('COMPLETED');
    usersRepo.findOne.mockResolvedValue(linkedUser);

    const result = await service.getStatus(row.id);

    expect(client.getStatus).toHaveBeenCalledWith({
      nationalId: NATIONAL_ID,
      transId: 't-1',
      random: '80',
      clientIp: '5.5.5.5',
    });
    expect(requestsRepo.update).toHaveBeenCalledWith(row.id, {
      lastPolledAt: expect.any(Date),
    });
    expect(requestsRepo.update).toHaveBeenCalledWith(
      { id: row.id, status: NafathRequestStatus.WAITING },
      expect.objectContaining({
        status: NafathRequestStatus.COMPLETED,
        statusSource: 'poll',
      }),
    );
    expect(usersRepo.findOne).toHaveBeenCalledWith({
      where: { nationalId: NATIONAL_ID },
    });
    expect(usersRepo.update).toHaveBeenCalledWith('user-1', {
      nafathVerifiedAt: expect.any(Date),
    });
    expect(auth.generateToken).toHaveBeenCalledWith(linkedUser);
    expect(result).toEqual({
      status: 'COMPLETED',
      token: 'aqar-jwt',
      isNewUser: false,
      user: linkedUser,
    });
  });

  it('does not poll again within 5 s of the last poll', async () => {
    const { service, requestsRepo, client } = makeService();
    requestsRepo.findOne.mockResolvedValue(
      makeRow({
        createdAt: new Date(Date.now() - 15_000),
        lastPolledAt: new Date(Date.now() - 2_000),
      }),
    );

    await expect(service.getStatus('id')).resolves.toMatchObject({
      status: 'WAITING',
    });
    expect(client.getStatus).not.toHaveBeenCalled();
  });

  it('treats upstream 400-034-051 as EXPIRED', async () => {
    const { service, requestsRepo, client } = makeService();
    const row = makeRow({ createdAt: new Date(Date.now() - 15_000) });
    requestsRepo.findOne
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce({ ...row, status: NafathRequestStatus.EXPIRED });
    client.getStatus.mockRejectedValue(
      new NafathApiError(400, '400-034-051', 1, 'expired'),
    );

    await expect(service.getStatus(row.id)).resolves.toEqual({
      status: 'EXPIRED',
    });
  });

  it('keeps WAITING when polling fails for other reasons', async () => {
    const { service, requestsRepo, client } = makeService();
    requestsRepo.findOne.mockResolvedValue(
      makeRow({ createdAt: new Date(Date.now() - 15_000) }),
    );
    client.getStatus.mockRejectedValue(
      new NafathApiError(0, null, null, 'timeout'),
    );

    await expect(service.getStatus('id')).resolves.toMatchObject({
      status: 'WAITING',
    });
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
    requestsRepo.findOne.mockResolvedValue(
      makeRow({ status: NafathRequestStatus.COMPLETED }),
    );
    requestsRepo.update.mockResolvedValue({ affected: 0 });

    await expect(service.getStatus('id')).rejects.toThrow(GoneException);
  });

  it('refuses inactive accounts', async () => {
    const { service, requestsRepo, usersRepo, auth } = makeService();
    requestsRepo.findOne.mockResolvedValue(
      makeRow({ status: NafathRequestStatus.COMPLETED }),
    );
    usersRepo.findOne.mockResolvedValue({ ...linkedUser, isActive: false });

    await expect(service.getStatus('id')).rejects.toThrow(ForbiddenException);
    expect(auth.generateToken).not.toHaveBeenCalled();
  });

  it('does not redeem a COMPLETED result older than the redeem window', async () => {
    const { service, requestsRepo, usersRepo, auth, linkTokens } =
      makeService();
    requestsRepo.findOne.mockResolvedValue(
      makeRow({
        status: NafathRequestStatus.COMPLETED,
        completedAt: new Date(Date.now() - 6 * 60 * 1000),
      }),
    );

    await expect(service.getStatus('id')).resolves.toEqual({
      status: 'EXPIRED',
    });
    expect(requestsRepo.update).not.toHaveBeenCalled();
    expect(usersRepo.findOne).not.toHaveBeenCalled();
    expect(auth.generateToken).not.toHaveBeenCalled();
    expect(linkTokens.sign).not.toHaveBeenCalled();
  });

  it('still redeems a COMPLETED result inside the redeem window', async () => {
    const { service, requestsRepo, usersRepo } = makeService();
    requestsRepo.findOne.mockResolvedValue(
      makeRow({
        status: NafathRequestStatus.COMPLETED,
        completedAt: new Date(Date.now() - 60 * 1000),
      }),
    );
    usersRepo.findOne.mockResolvedValue(linkedUser);

    await expect(service.getStatus('id')).resolves.toMatchObject({
      status: 'COMPLETED',
      token: 'aqar-jwt',
    });
    expect(requestsRepo.update).toHaveBeenCalledWith(
      { id: expect.any(String), consumedAt: IsNull() },
      { consumedAt: expect.any(Date) },
    );
  });

  it('serves a callback that completed while lazy-expiry was racing it', async () => {
    const { service, requestsRepo, usersRepo } = makeService();
    const row = makeRow({
      expiresAt: new Date(Date.now() - 21_000),
      createdAt: new Date(Date.now() - 81_000),
    });
    requestsRepo.findOne
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce({ ...row, status: NafathRequestStatus.COMPLETED });
    requestsRepo.update
      .mockResolvedValueOnce({ affected: 0 }) // finish(): callback won
      .mockResolvedValue({ affected: 1 }); // redeem claim, etc.
    usersRepo.findOne.mockResolvedValue(linkedUser);

    await expect(service.getStatus(row.id)).resolves.toMatchObject({
      status: 'COMPLETED',
      token: 'aqar-jwt',
    });
    expect(requestsRepo.findOne).toHaveBeenLastCalledWith({
      where: { id: row.id },
    });
  });

  it('passes REJECTED and FAILED through', async () => {
    const { service, requestsRepo } = makeService();
    requestsRepo.findOne.mockResolvedValueOnce(
      makeRow({ status: NafathRequestStatus.REJECTED }),
    );
    await expect(service.getStatus('id')).resolves.toEqual({
      status: 'REJECTED',
    });

    requestsRepo.findOne.mockResolvedValueOnce(
      makeRow({ status: NafathRequestStatus.FAILED }),
    );
    await expect(service.getStatus('id')).resolves.toEqual({
      status: 'FAILED',
    });
  });
});

describe('NafathService.handleCallback', () => {
  const body = {
    token: 'jwt',
    transId: 't-1',
    requestId: '2b1f8c1e-7d1a-4c5e-9a39-0f1c2d3e4f50',
  };
  const completedPayload = {
    aud: 'AQAR',
    transId: 't-1',
    status: 'COMPLETED',
    nin: NATIONAL_ID,
  };

  it('rejects tokens that fail verification with 400', async () => {
    const { service, verifier, requestsRepo } = makeService();
    verifier.verify.mockRejectedValue(new NafathTokenError('bad signature'));

    await expect(service.handleCallback(body)).rejects.toThrow(
      BadRequestException,
    );
    expect(requestsRepo.update).not.toHaveBeenCalled();
  });

  it('returns 503 when the JWKS cannot be fetched (so Nafath can retry)', async () => {
    const { service, verifier } = makeService();
    verifier.verify.mockRejectedValue(
      new NafathApiError(503, null, null, 'down'),
    );

    await expect(service.handleCallback(body)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('rejects a JWT whose transId differs from the body', async () => {
    const { service, verifier } = makeService();
    verifier.verify.mockResolvedValue({
      ...completedPayload,
      transId: 'other',
    });

    await expect(service.handleCallback(body)).rejects.toThrow(
      BadRequestException,
    );
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

    await expect(service.handleCallback(body)).rejects.toThrow(
      BadRequestException,
    );
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
    requestsRepo.findOne.mockResolvedValue(
      makeRow({ status: NafathRequestStatus.COMPLETED, statusSource: 'poll' }),
    );
    requestsRepo.update
      .mockResolvedValueOnce({ affected: 0 })
      .mockResolvedValueOnce({ affected: 1 });

    await expect(service.handleCallback(body)).resolves.toBeUndefined();
    expect(requestsRepo.update).toHaveBeenLastCalledWith(
      {
        id: body.requestId,
        status: NafathRequestStatus.COMPLETED,
        claims: IsNull(),
      },
      { claims: completedPayload },
    );
  });

  it('records REJECTED without claims', async () => {
    const { service, verifier, requestsRepo } = makeService();
    verifier.verify.mockResolvedValue({
      ...completedPayload,
      status: 'REJECTED',
    });
    requestsRepo.findOne.mockResolvedValue(makeRow());

    await service.handleCallback(body);
    expect(requestsRepo.update).toHaveBeenCalledWith(
      { id: body.requestId, status: NafathRequestStatus.WAITING },
      expect.objectContaining({
        status: NafathRequestStatus.REJECTED,
        claims: null,
      }),
    );
  });

  it('ignores a non-terminal status in the JWT', async () => {
    const { service, verifier, requestsRepo } = makeService();
    verifier.verify.mockResolvedValue({
      ...completedPayload,
      status: 'WAITING',
    });
    requestsRepo.findOne.mockResolvedValue(makeRow());

    await expect(service.handleCallback(body)).resolves.toBeUndefined();
    expect(requestsRepo.update).not.toHaveBeenCalled();
  });
});

describe('NafathService.link', () => {
  function setup() {
    const ctx = makeService();
    const txRequests = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const txUsers = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOneOrFail: jest
        .fn()
        .mockResolvedValue({ id: 'user-1', isVerified: true }),
    };
    ctx.dataSource.transaction.mockImplementation(
      async (cb: (m: unknown) => unknown) =>
        cb({
          getRepository: (entity: unknown) =>
            entity === User ? txUsers : txRequests,
        }),
    );
    ctx.linkTokens.verify.mockReturnValue('req-1');
    return { ...ctx, txRequests, txUsers };
  }

  const completedRow = () =>
    makeRow({
      id: 'req-1',
      status: NafathRequestStatus.COMPLETED,
      consumedAt: new Date(),
    });

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
    expect(txUsers.update).toHaveBeenCalledWith(
      { id: 'user-1', nationalId: IsNull() },
      {
        nationalId: NATIONAL_ID,
        nafathVerifiedAt: expect.any(Date),
        isVerified: true,
      },
    );
    expect(txRequests.update).toHaveBeenCalledWith('req-1', {
      linkedUserId: 'user-1',
    });
  });

  it('propagates an invalid link token as 401', async () => {
    const { service, linkTokens, dataSource } = setup();
    linkTokens.verify.mockImplementation(() => {
      throw new UnauthorizedException();
    });

    await expect(service.link('user-1', 'bad')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    [
      'not completed',
      makeRow({ id: 'req-1', status: NafathRequestStatus.WAITING }),
    ],
    [
      'not redeemed',
      makeRow({
        id: 'req-1',
        status: NafathRequestStatus.COMPLETED,
        consumedAt: null,
      }),
    ],
    [
      'already linked',
      makeRow({
        id: 'req-1',
        status: NafathRequestStatus.COMPLETED,
        consumedAt: new Date(),
        linkedUserId: 'u-9',
      }),
    ],
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
    txUsers.update.mockResolvedValue({ affected: 0 });

    await expect(service.link('user-1', 'link-token')).rejects.toMatchObject({
      response: { error: 'NAFATH_ACCOUNT_HAS_OTHER_ID' },
    });
    expect(txRequests.update).not.toHaveBeenCalled();
  });

  it('is idempotent when the current user already owns this national ID', async () => {
    const { service, txRequests, txUsers } = setup();
    txRequests.findOne.mockResolvedValue(completedRow());
    txUsers.findOne.mockResolvedValue({ id: 'user-1' });

    await expect(service.link('user-1', 'link-token')).resolves.toBeDefined();
    expect(txUsers.update).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ nationalId: NATIONAL_ID }),
    );
    expect(txRequests.update).toHaveBeenCalledWith('req-1', {
      linkedUserId: 'user-1',
    });
  });

  it('maps a unique-constraint race to NAFATH_ID_LINKED_TO_OTHER_ACCOUNT', async () => {
    const { service, txRequests, txUsers } = setup();
    txRequests.findOne.mockResolvedValue(completedRow());
    txUsers.findOne.mockResolvedValue(null);
    txUsers.update.mockRejectedValue(
      Object.assign(new Error('duplicate'), { driverError: { code: '23505' } }),
    );

    await expect(service.link('user-1', 'link-token')).rejects.toMatchObject({
      response: { error: 'NAFATH_ID_LINKED_TO_OTHER_ACCOUNT' },
    });
    expect(txRequests.update).not.toHaveBeenCalled();
  });
});

describe('NafathService web login', () => {
  const REDIRECT = 'https://aqora.sa/ar/nafath/callback';
  const webPayload = { aud: 'AQAR', nationalId: NATIONAL_ID, arabicName: 'x' };

  it('returns the Nafath page URL for a new session', async () => {
    const { service, client } = makeService({ webRedirectUrl: REDIRECT });
    client.createWebSession.mockResolvedValue({ url: 'https://nafath/page' });

    await expect(service.startWebSession('en', '5.5.5.5')).resolves.toEqual({
      url: 'https://nafath/page',
    });
    expect(client.createWebSession).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'en', clientIp: '5.5.5.5' }),
    );
  });

  it('refuses to start without a configured redirect URL', async () => {
    const { service } = makeService({ webRedirectUrl: '' });
    await expect(service.startWebSession(undefined, '5.5.5.5')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('logs a linked user in and puts the token in the URL fragment', async () => {
    const { service, client, verifier, usersRepo, requestsRepo } = makeService({
      webRedirectUrl: REDIRECT,
    });
    client.retrieveWebToken.mockResolvedValue('elm.jwt');
    verifier.verify.mockResolvedValue(webPayload);
    usersRepo.findOne.mockResolvedValue({ id: 'user-1', isActive: true });

    await expect(service.completeWebLogin('state-1', '5.5.5.5')).resolves.toBe(
      `${REDIRECT}#token=aqar-jwt`,
    );
    expect(client.retrieveWebToken).toHaveBeenCalledWith('state-1', '5.5.5.5');
    const saved = requestsRepo.save.mock.calls[0][0] as NafathRequest;
    expect(saved).toMatchObject({
      nationalId: NATIONAL_ID,
      service: 'WEB',
      status: NafathRequestStatus.COMPLETED,
      claims: webPayload,
    });
    expect(saved.consumedAt).toBeInstanceOf(Date);
  });

  it('returns a link token for an unlinked national ID', async () => {
    const { service, client, verifier, usersRepo, linkTokens, requestsRepo } =
      makeService({ webRedirectUrl: REDIRECT });
    client.retrieveWebToken.mockResolvedValue('elm.jwt');
    verifier.verify.mockResolvedValue(webPayload);
    usersRepo.findOne.mockResolvedValue(null);

    await expect(service.completeWebLogin('state-1', '5.5.5.5')).resolves.toBe(
      `${REDIRECT}#linkToken=link-token`,
    );
    const saved = requestsRepo.save.mock.calls[0][0] as NafathRequest;
    expect(linkTokens.sign).toHaveBeenCalledWith(saved.id);
  });

  it('redirects with an error code when Elm rejects the state', async () => {
    const { service, client } = makeService({ webRedirectUrl: REDIRECT });
    client.retrieveWebToken.mockRejectedValue(
      new NafathApiError(401, '401-033-024', 1, 'bad state'),
    );
    await expect(service.completeWebLogin('bad', '5.5.5.5')).resolves.toBe(
      `${REDIRECT}#error=NAFATH_UNAVAILABLE`,
    );
  });

  it('redirects with NAFATH_INVALID_CALLBACK for a bad token or missing ID', async () => {
    const { service, client, verifier } = makeService({
      webRedirectUrl: REDIRECT,
    });
    client.retrieveWebToken.mockResolvedValue('elm.jwt');
    verifier.verify.mockResolvedValueOnce({ aud: 'AQAR' });
    await expect(service.completeWebLogin('s', '5.5.5.5')).resolves.toBe(
      `${REDIRECT}#error=NAFATH_INVALID_CALLBACK`,
    );
    verifier.verify.mockRejectedValueOnce(new NafathTokenError('bad sig'));
    await expect(service.completeWebLogin('s', '5.5.5.5')).resolves.toBe(
      `${REDIRECT}#error=NAFATH_INVALID_CALLBACK`,
    );
  });

  it('passes inactive-account errors through as their code', async () => {
    const { service, client, verifier, usersRepo } = makeService({
      webRedirectUrl: REDIRECT,
    });
    client.retrieveWebToken.mockResolvedValue('elm.jwt');
    verifier.verify.mockResolvedValue(webPayload);
    usersRepo.findOne.mockResolvedValue({ id: 'user-1', isActive: false });
    await expect(service.completeWebLogin('s', '5.5.5.5')).resolves.toBe(
      `${REDIRECT}#error=NAFATH_ACCOUNT_INACTIVE`,
    );
  });
});
