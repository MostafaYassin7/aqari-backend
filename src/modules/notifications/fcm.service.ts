import * as fs from 'fs';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as admin from 'firebase-admin';
import { Repository } from 'typeorm';
import { PushToken } from './entities/push-token.entity';

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private app: admin.app.App | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(PushToken)
    private readonly pushTokenRepo: Repository<PushToken>,
  ) {}

  onModuleInit() {
    try {
      const serviceAccount = this.loadServiceAccount();
      if (!serviceAccount) return;
      this.app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      this.logger.log('Firebase Admin initialized');
    } catch {
      this.logger.error('Failed to initialize Firebase Admin');
    }
  }

  private loadServiceAccount(): admin.ServiceAccount | null {
    const filePath = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH');
    if (filePath) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as admin.ServiceAccount;
    }

    const raw = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
    if (raw) {
      return JSON.parse(raw) as admin.ServiceAccount;
    }

    this.logger.warn('No Firebase credentials set — FCM disabled');
    return null;
  }

  async sendFcmPushNotification(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!this.app || tokens.length === 0) return;

    const response = await this.app.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data,
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });

    const staleTokens: string[] = [];
    response.responses.forEach((res: admin.messaging.SendResponse, idx: number) => {
      if (!res.success && res.error?.code === 'messaging/registration-token-not-registered') {
        staleTokens.push(tokens[idx]);
      }
    });

    if (staleTokens.length > 0) {
      await this.pushTokenRepo.delete(staleTokens.map((token) => ({ token })));
      this.logger.log(`Removed ${staleTokens.length} stale FCM token(s)`);
    }
  }
}
