import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import crypto from 'crypto';
import { User } from '../users/entities/user.entity';
import { WalletService } from '../wallet/wallet.service';
import { ExecutePaymentDto } from './dto/execute-payment.dto';
import { Payment, PaymentStatus, PaymentType } from './entities/payment.entity';

// ─── MyFatoorah response shapes ──────────────────────────────────────────────

export interface MfResponse<T> {
  IsSuccess: boolean;
  Message: string;
  Data: T;
}

export interface MfSessionData {
  SessionId: string;
  CountryCode: string;
}

interface MfExecuteData {
  InvoiceId: number;
  PaymentURL: string | null;
}

interface MfPaymentStatusData {
  InvoiceStatus: string;
  InvoiceError?: string;
}

export interface MfWebhookBody {
  EventType?: unknown;
  Event?: string;
  Data?: {
    TransactionStatus?: string;
    InvoiceId?: number | string;
    GatewayReference?: unknown;
    [key: string]: unknown;
  };
}

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class PaymentService {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly callbackUrl: string;
  private readonly webhookSecret: string | undefined;
  private readonly defaultCurrency: string;

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly walletService: WalletService,
    private readonly configService: ConfigService,
  ) {
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    this.baseUrl = isProduction
      ? this.configService.getOrThrow<string>('MYFATOORAH_LIVE_SA__BASE_URL')
      : this.configService.getOrThrow<string>('MYFATOORAH_TEST_BASE_URL');
    this.token = isProduction
      ? this.configService.getOrThrow<string>('MYFATOORAH_LIVE_TOKEN')
      : this.configService.getOrThrow<string>('MYFATOORAH_TEST_TOKEN');
    this.defaultCurrency = isProduction ? 'SAR' : 'KWD';
    this.callbackUrl = this.configService.getOrThrow<string>('MYFATOORAH_CALLBACK_URL');
    this.webhookSecret = this.configService.get<string>('MYFATOORAH_WEBHOOK_SECRET');
  }

  // ─── MYFATOORAH API ──────────────────────────────────────────────────────────

  async initiateSession(invoiceAmount: number, currencyIso?: string): Promise<MfResponse<MfSessionData>> {
    const res = await fetch(`${this.baseUrl}/v2/InitiateSession`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ InvoiceAmount: invoiceAmount, CurrencyIso: currencyIso ?? this.defaultCurrency }),
    });
    const data = await res.json() as MfResponse<MfSessionData>;
    if (!data.IsSuccess) {
      throw new BadRequestException(data.Message ?? 'MyFatoorah InitiateSession failed');
    }
    return data;
  }

  private async callExecutePayment(paymentData: Record<string, unknown>): Promise<MfResponse<MfExecuteData>> {
    const res = await fetch(`${this.baseUrl}/v2/ExecutePayment`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(paymentData),
    });
    const data = await res.json() as MfResponse<MfExecuteData>;
    if (!data.IsSuccess) {
      throw new BadRequestException(data.Message ?? 'MyFatoorah ExecutePayment failed');
    }
    return data;
  }

  private async getPaymentStatus(invoiceId: string): Promise<MfResponse<MfPaymentStatusData>> {
    const res = await fetch(`${this.baseUrl}/v2/GetPaymentStatus`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ Key: invoiceId, KeyType: 'InvoiceId' }),
    });
    const data = await res.json() as MfResponse<MfPaymentStatusData>;
    if (!data.IsSuccess) {
      throw new BadRequestException(data.Message ?? 'MyFatoorah GetPaymentStatus failed');
    }
    return data;
  }

  // ─── WALLET TOP-UP ───────────────────────────────────────────────────────────

  async executeTopUp(user: User, dto: ExecutePaymentDto): Promise<Payment> {
    const currency = dto.displayCurrencyIso ?? this.defaultCurrency;

    const wallet = await this.walletService.getOrCreateWallet(user.id);

    const mfResponse = await this.callExecutePayment({
      SessionId: dto.sessionId,
      InvoiceValue: dto.invoiceValue,
      DisplayCurrencyIso: currency,
      CustomerName: user.name ?? 'Customer',
      CustomerEmail: user.email ?? `${user.id}@aqar.app`,
      CallBackUrl: this.callbackUrl,
      ErrorUrl: this.callbackUrl,
      Language: 'en',
      CustomerReference: user.id,
      InvoiceItems: [{ ItemName: 'Wallet Top-up', Quantity: 1, UnitPrice: dto.invoiceValue }],
    });

    const payment = this.paymentRepository.create({
      userId: user.id,
      type: PaymentType.TOP_UP,
      referenceId: wallet.id,
      invoiceId: String(mfResponse.Data.InvoiceId),
      invoiceValue: String(dto.invoiceValue),
      displayCurrencyIso: currency,
      paymentStatus: PaymentStatus.PENDING,
      paymentURL: mfResponse.Data.PaymentURL ?? null,
    });

    return this.paymentRepository.save(payment);
  }

  // ─── WEBHOOK ─────────────────────────────────────────────────────────────────

  async handleWebhook(body: MfWebhookBody, signature?: string): Promise<void> {
    if (this.webhookSecret && signature) {
      const isValid = this.validateSignature(body, this.webhookSecret, signature);
      if (!isValid) throw new BadRequestException('Invalid webhook signature');
    }

    if (!body.EventType || !body.Data) return;

    const eventType = Number(body.EventType);
    const transactionStatus = body.Data.TransactionStatus?.toUpperCase();
    const invoiceId = String(body.Data.InvoiceId ?? '');

    if (!invoiceId || eventType !== 1) return;

    const payment = await this.paymentRepository.findOne({ where: { invoiceId } });
    if (!payment) return;

    if (transactionStatus === 'SUCCESS') {
      await this.paymentRepository.update(payment.id, {
        paymentStatus: PaymentStatus.PAID,
      });

      if (payment.type === PaymentType.TOP_UP) {
        await this.walletService.topUp(
          payment.userId,
          Number(payment.invoiceValue),
          'MyFatoorah',
        );
      }
      // PaymentType.RESERVATION and PaymentType.PROMOTION handled when implemented
    } else if (transactionStatus === 'FAILED') {
      const statusRes = await this.getPaymentStatus(invoiceId);
      const errorMsg = statusRes.Data.InvoiceError ?? 'Payment failed';

      await this.paymentRepository.update(payment.id, {
        paymentStatus: PaymentStatus.FAILED,
        errorMessage: errorMsg,
      });
    }
  }

  // ─── SIGNATURE VALIDATION ────────────────────────────────────────────────────

  validateSignature(bodyData: MfWebhookBody, secret: string, myFatoorahSignature: string): boolean {
    const data: Record<string, unknown> = { ...bodyData.Data };

    if (bodyData.Event === 'RefundStatusChanged') {
      delete data['GatewayReference'];
    }

    const orderedString = Object.keys(data)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => `${key}=${String(data[key] ?? '')}`)
      .join(',');

    const hash = crypto
      .createHmac('sha256', secret)
      .update(orderedString)
      .digest('base64');

    return hash === myFatoorahSignature;
  }

  // ─── HELPERS ─────────────────────────────────────────────────────────────────

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }
}
