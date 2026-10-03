import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import {
  NafathRequest,
  NafathRequestStatus,
} from './entities/nafath-request.entity';
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
    if (res.affected)
      this.logger.log(`Expired ${res.affected} stale Nafath request(s)`);
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeOld(): Promise<void> {
    const cutoff = new Date(
      Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000,
    );
    const res = await this.requestsRepo.delete({ createdAt: LessThan(cutoff) });
    if (res.affected)
      this.logger.log(
        `Purged ${res.affected} Nafath request(s) past retention`,
      );
  }
}
