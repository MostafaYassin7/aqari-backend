import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AuthService } from '../auth/auth.service';
import { User } from '../users/entities/user.entity';
import {
  NafathRequest,
  NafathRequestStatus,
  NafathStatusSource,
} from './entities/nafath-request.entity';
import { NafathCallbackDto } from './dto/nafath-callback.dto';
import { NafathClient } from './nafath.client';
import { NAFATH_CONFIG, NafathConfig } from './nafath.config';
import {
  NAFATH_CODES,
  NafathApiError,
  NafathTokenError,
  nafathError,
  toHttpError,
} from './nafath.errors';
import { NafathJwtVerifier, NafathTokenPayload } from './nafath-jwt.verifier';
import { NafathLinkTokenService } from './nafath-link-token.service';

export type NafathStatusResponse =
  | { status: 'WAITING'; expiresAt: Date }
  | {
      status:
        | NafathRequestStatus.REJECTED
        | NafathRequestStatus.EXPIRED
        | NafathRequestStatus.FAILED;
    }
  | {
      status: 'COMPLETED';
      token: string;
      isNewUser: false;
      user: Partial<User>;
    }
  | { status: 'COMPLETED'; linkRequired: true; linkToken: string };

const POLL_AFTER_MS = 10_000;
const POLL_EVERY_MS = 5_000;
const PER_ID_WINDOW_MS = 10 * 60 * 1000;
const PER_ID_MAX_REQUESTS = 5;
/** How long a COMPLETED, unconsumed result can still be exchanged for a session. */
export const REDEEM_WINDOW_MS = 5 * 60 * 1000;

export function parseTerminalStatus(
  value: unknown,
): NafathRequestStatus | null {
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

/** Nafath Web tokens carry `nationalId`; app-push tokens use `nin` / `iqamaNumber`. */
export function extractNationalId(payload: NafathTokenPayload): string | null {
  for (const key of [
    'nationalId',
    'nin',
    'iqamaNumber',
    'visaNumber',
    'borderNumber',
  ]) {
    const value = payload[key];
    const text = typeof value === 'number' ? String(value) : value;
    if (typeof text === 'string' && /^\d{10}$/.test(text)) return text;
  }
  return null;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    (err as { driverError?: { code?: string } })?.driverError?.code === '23505'
  );
}

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

    const recent = await this.requestsRepo.count({
      where: {
        nationalId,
        createdAt: MoreThan(new Date(Date.now() - PER_ID_WINDOW_MS)),
      },
    });
    if (recent >= PER_ID_MAX_REQUESTS) throw nafathError.rateLimited();

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

  async getStatus(requestId: string): Promise<NafathStatusResponse> {
    this.assertEnabled();

    let row = await this.requestsRepo.findOne({ where: { id: requestId } });
    if (!row) throw nafathError.notFound();

    if (
      row.status === NafathRequestStatus.WAITING &&
      Date.now() >= this.staleAt(row)
    ) {
      const expired = await this.finish(
        row.id,
        NafathRequestStatus.EXPIRED,
        null,
        null,
      );
      if (expired) {
        row = { ...row, status: NafathRequestStatus.EXPIRED };
      } else {
        // A callback won the race; show what it recorded instead of assuming EXPIRED.
        row =
          (await this.requestsRepo.findOne({ where: { id: row.id } })) ??
          ({ ...row, status: NafathRequestStatus.EXPIRED } as NafathRequest);
      }
    }

    if (row.status === NafathRequestStatus.WAITING && this.shouldPoll(row)) {
      row = await this.pollUpstream(row);
    }

    switch (row.status) {
      case NafathRequestStatus.WAITING:
        return { status: 'WAITING', expiresAt: row.expiresAt };
      case NafathRequestStatus.COMPLETED:
        if (
          !row.consumedAt &&
          row.completedAt &&
          Date.now() - row.completedAt.getTime() > REDEEM_WINDOW_MS
        ) {
          return { status: NafathRequestStatus.EXPIRED };
        }
        return this.redeem(row);
      default:
        return { status: row.status };
    }
  }

  async handleCallback(body: NafathCallbackDto): Promise<void> {
    this.assertEnabled();

    let payload: NafathTokenPayload;
    try {
      payload = await this.verifier.verify(body.token);
    } catch (err) {
      if (err instanceof NafathTokenError) {
        this.logger.warn(
          `Nafath callback rejected transId=${body.transId}: ${err.message}`,
        );
        throw nafathError.invalidToken();
      }
      this.logUpstreamError('callback key fetch', body.requestId, err);
      throw nafathError.unavailable();
    }

    if (payload.transId !== body.transId) {
      this.logger.warn(
        `Nafath callback transId mismatch requestId=${body.requestId}`,
      );
      throw nafathError.invalidToken();
    }

    const row = await this.requestsRepo.findOne({
      where: { id: body.requestId },
    });
    if (!row) {
      this.logger.warn(
        `Nafath callback for unknown requestId=${body.requestId}`,
      );
      return;
    }
    if (row.transId !== body.transId) {
      this.logger.warn(
        `Nafath callback transId does not match requestId=${body.requestId}`,
      );
      throw nafathError.invalidToken();
    }

    const status = parseTerminalStatus(payload.status);
    if (!status) {
      this.logger.warn(
        `Nafath callback with non-terminal status requestId=${body.requestId}`,
      );
      return;
    }

    const claims = status === NafathRequestStatus.COMPLETED ? payload : null;
    const changed = await this.finish(row.id, status, 'callback', claims);

    if (!changed && claims) {
      // Polling (or an earlier callback) already set COMPLETED; keep the signed claims once.
      await this.requestsRepo.update(
        { id: row.id, status: NafathRequestStatus.COMPLETED, claims: IsNull() },
        { claims } as QueryDeepPartialEntity<NafathRequest>,
      );
    }
  }

  /** Nafath Web: returns the signed Nafath login page URL for the browser. */
  async startWebSession(
    lang: 'ar' | 'en' | undefined,
    clientIp: string,
  ): Promise<{ url: string }> {
    this.assertEnabled();
    if (!this.config.webRedirectUrl) throw nafathError.disabled();
    const requestId = randomUUID();
    try {
      return await this.client.createWebSession({
        locale: lang ?? this.config.locale,
        requestId,
        clientIp,
      });
    } catch (err) {
      this.logUpstreamError('web session', requestId, err);
      throw toHttpError(err);
    }
  }

  /**
   * Nafath Web: the browser came back from Nafath with a single-use `state`.
   * Exchanges it for the signed JWT, then logs the user in or asks for a link.
   * Returns the frontend URL to redirect the browser to; the outcome travels in
   * the URL fragment (`#token=` | `#linkToken=` | `#error=`), which browsers
   * never send to any server.
   */
  async completeWebLogin(state: string, clientIp: string): Promise<string> {
    const target = this.config.webRedirectUrl;
    if (!this.config.enabled || !target) throw nafathError.disabled();

    try {
      const token = await this.client.retrieveWebToken(state, clientIp);
      const payload = await this.verifier.verify(token);
      // Claim names only (no values) — to learn the real token layout.
      this.logger.log(
        `Nafath web token claims: ${Object.keys(payload).join(',')}`,
      );

      const nationalId = extractNationalId(payload);
      if (!nationalId) throw new NafathTokenError('no national ID claim');

      const now = new Date();
      const row = this.requestsRepo.create({
        id: randomUUID(),
        nationalId,
        service: 'WEB',
        status: NafathRequestStatus.COMPLETED,
        statusSource: 'callback',
        claims: payload,
        clientIp,
        expiresAt: now,
        completedAt: now,
        consumedAt: now,
      });
      await this.requestsRepo.save(row);

      const result = await this.loginOrLink(row);
      return 'token' in result
        ? `${target}#token=${encodeURIComponent(result.token)}`
        : `${target}#linkToken=${encodeURIComponent(result.linkToken)}`;
    } catch (err) {
      let code = 'NAFATH_UNAVAILABLE';
      if (err instanceof NafathTokenError) {
        code = 'NAFATH_INVALID_CALLBACK';
        this.logger.warn(`Nafath web login rejected: ${err.message}`);
      } else if (err instanceof NafathApiError) {
        this.logUpstreamError('web login', '-', err);
      } else if (err instanceof HttpException) {
        const body = err.getResponse() as { error?: unknown };
        if (typeof body?.error === 'string') code = body.error;
        this.logger.warn(`Nafath web login failed: ${code}`);
      } else {
        this.logger.error(`Nafath web login failed: ${(err as Error).message}`);
      }
      return `${target}#error=${code}`;
    }
  }

  async link(
    userId: string,
    linkToken: string,
  ): Promise<{ user: Partial<User> }> {
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

      const owner = await users.findOne({
        where: { nationalId: row.nationalId },
      });
      if (owner && owner.id !== userId) throw nafathError.idLinkedToOther();

      try {
        let res;
        if (owner?.id === userId) {
          // Idempotent re-link: user already owns this national ID
          res = await users.update(userId, {
            nationalId: row.nationalId,
            nafathVerifiedAt: new Date(),
            isVerified: true,
          });
        } else {
          // New link: only update if user doesn't already have a different national ID
          res = await users.update(
            { id: userId, nationalId: IsNull() },
            {
              nationalId: row.nationalId,
              nafathVerifiedAt: new Date(),
              isVerified: true,
            },
          );
        }
        if ((res.affected ?? 0) === 0 && !owner)
          throw nafathError.accountHasOtherId();
      } catch (err) {
        if (isUniqueViolation(err)) throw nafathError.idLinkedToOther();
        throw err;
      }
      await requests.update(row.id, { linkedUserId: userId });

      const user = await users.findOneOrFail({ where: { id: userId } });
      return { user: this.auth.sanitize(user) };
    });
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
      {
        status,
        statusSource: source,
        completedAt: new Date(),
        claims,
      } as QueryDeepPartialEntity<NafathRequest>,
    );
    return (res.affected ?? 0) > 0;
  }

  private logUpstreamError(op: string, requestId: string, err: unknown): void {
    if (err instanceof NafathApiError) {
      const hint =
        err.httpStatus === 403
          ? ' (check APP-ID/APP-KEY for this environment)'
          : '';
      this.logger.error(
        `Nafath ${op} failed requestId=${requestId} http=${err.httpStatus} code=${err.code} ref=${err.reference}${hint}`,
      );
    } else {
      this.logger.error(
        `Nafath ${op} failed requestId=${requestId}: ${(err as Error).message}`,
      );
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
        (err.code === NAFATH_CODES.TRX_EXPIRED ||
          err.code === NAFATH_CODES.TRX_NOT_FOUND)
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
    return this.loginOrLink(row);
  }

  /** Completed + consumed request → Aqar session for the linked user, or a link token. */
  private async loginOrLink(
    row: NafathRequest,
  ): Promise<Extract<NafathStatusResponse, { status: 'COMPLETED' }>> {
    const user = await this.usersRepo.findOne({
      where: { nationalId: row.nationalId },
    });
    if (!user) {
      return {
        status: 'COMPLETED',
        linkRequired: true,
        linkToken: this.linkTokens.sign(row.id),
      };
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
}
