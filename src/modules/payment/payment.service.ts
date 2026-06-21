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

  async initiateSession(invoiceAmount: number, currencyIso?: string) {
    const res = await fetch(`${this.baseUrl}/v2/InitiateSession`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ InvoiceAmount: invoiceAmount, CurrencyIso: currencyIso ?? this.defaultCurrency }),
    });
    const data = await res.json() as any;
    if (!data.IsSuccess) {
      throw new BadRequestException(data.Message ?? 'MyFatoorah InitiateSession failed');
    }
    return data;
  }

  private async callExecutePayment(paymentData: Record<string, any>) {
    const res = await fetch(`${this.baseUrl}/v2/ExecutePayment`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(paymentData),
    });
    const data = await res.json() as any;
    if (!data.IsSuccess) {
      throw new BadRequestException(data.Message ?? 'MyFatoorah ExecutePayment failed');
    }
    return data;
  }

  private async getPaymentStatus(invoiceId: string) {
    const res = await fetch(`${this.baseUrl}/v2/GetPaymentStatus`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ Key: invoiceId, KeyType: 'InvoiceId' }),
    });
    const data = await res.json() as any;
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

  async handleWebhook(body: any, signature?: string): Promise<void> {
    if (this.webhookSecret && signature) {
      const isValid = this.validateSignature(body, this.webhookSecret, signature);
      if (!isValid) throw new BadRequestException('Invalid webhook signature');
    }

    if (!body.EventType || !body.Data) return;

    const eventType = Number(body.EventType);
    const transactionStatus = body.Data?.TransactionStatus?.toUpperCase() as string;
    const invoiceId = String(body.Data?.InvoiceId ?? '');

    if (!invoiceId) return;

    if (eventType !== 1) return;

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
      const errorMsg = statusRes.Data?.InvoiceError ?? 'Payment failed';

      await this.paymentRepository.update(payment.id, {
        paymentStatus: PaymentStatus.FAILED,
        errorMessage: errorMsg,
      });
    }
  }

  // ─── SIGNATURE VALIDATION ────────────────────────────────────────────────────

  validateSignature(bodyData: any, secret: string, myFatoorahSignature: string): boolean {
    const data = { ...bodyData['Data'] };

    if (bodyData['Event'] === 'RefundStatusChanged') {
      delete data['GatewayReference'];
    }

    const orderedKeys = Object.keys(data).sort((a, b) => a.localeCompare(b));
    let orderedString = orderedKeys
      .map((key) => `${key}=${data[key] ?? ''}`)
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
