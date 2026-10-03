import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
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
}
