import * as crypto from 'crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PushToken } from './entities/push-token.entity';

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private serviceAccount: ServiceAccount | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(PushToken)
    private readonly pushTokenRepo: Repository<PushToken>,
  ) {}

  onModuleInit() {
    const raw = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
    const filePath = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH');

    try {
      if (filePath) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('fs') as typeof import('fs');
        this.serviceAccount = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ServiceAccount;
      } else if (raw) {
        this.serviceAccount = JSON.parse(raw) as ServiceAccount;
      } else {
        this.logger.warn('No Firebase credentials set — FCM disabled');
        return;
      }
      this.logger.log('Firebase Admin initialized');
    } catch {
      this.logger.error('Failed to initialize Firebase credentials');
    }
  }

  private signJwt(payload: object, privateKey: string): string {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const unsigned = `${header}.${body}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(unsigned);
    const signature = sign.sign(privateKey, 'base64url');
    return `${unsigned}.${signature}`;
  }

  private async getAccessToken(): Promise<string> {
    if (!this.serviceAccount) throw new Error('FCM not initialized');

    const now = Math.floor(Date.now() / 1000);
    const jwt = this.signJwt(
      {
        iss: this.serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      },
      this.serviceAccount.private_key,
    );

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });

    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new Error('Failed to get FCM access token');
    return data.access_token;
  }

  async sendFcmPushNotification(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!this.serviceAccount || tokens.length === 0) return;

    const accessToken = await this.getAccessToken();
    const url = `https://fcm.googleapis.com/v1/projects/${this.serviceAccount.project_id}/messages:send`;

    const staleTokens: string[] = [];

    await Promise.all(
      tokens.map(async (token) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title, body },
              data,
              android: { priority: 'high' },
              apns: { payload: { aps: { sound: 'default' } } },
            },
          }),
        });

        if (!res.ok) {
          const err = (await res.json()) as { error?: { details?: { errorCode?: string }[] } };
          const code = err.error?.details?.[0]?.errorCode;
          if (code === 'UNREGISTERED') {
            staleTokens.push(token);
          } else {
            this.logger.error(`FCM send failed for token ${token.slice(0, 20)}...`, JSON.stringify(err));
          }
        }
      }),
    );

    if (staleTokens.length > 0) {
      await Promise.all(staleTokens.map((token) => this.pushTokenRepo.delete({ token })));
      this.logger.log(`Removed ${staleTokens.length} stale FCM token(s)`);
    }
  }
}
