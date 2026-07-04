import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  NotificationReferenceType,
  NotificationType,
} from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingHold, BookingHoldStatus } from './entities/booking-hold.entity';
import { InvoiceReferenceType } from './entities/invoice.entity';
import { Invoice } from './entities/invoice.entity';
import {
  Transaction,
  TransactionReferenceType,
  TransactionType,
} from './entities/transaction.entity';
import { Wallet } from './entities/wallet.entity';

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(Wallet)
    private readonly walletsRepo: Repository<Wallet>,
    @InjectRepository(Transaction)
    private readonly transactionsRepo: Repository<Transaction>,
    @InjectRepository(Invoice)
    private readonly invoicesRepo: Repository<Invoice>,
    @InjectRepository(BookingHold)
    private readonly bookingHoldsRepo: Repository<BookingHold>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ─── GET OR CREATE ───────────────────────────────────────────────────────────

  async getOrCreateWallet(userId: string): Promise<Wallet> {
    let wallet = await this.walletsRepo.findOne({ where: { userId } });
    if (!wallet) {
      wallet = this.walletsRepo.create({ userId });
      wallet = await this.walletsRepo.save(wallet);
    }
    return wallet;
  }

  async getBalance(userId: string): Promise<Wallet & { heldBalance: string; pendingEarnings: string }> {
    const wallet = await this.getOrCreateWallet(userId);
    const [heldBalance, pendingEarnings] = await Promise.all([
      this.sumActiveHolds('guestWalletId', wallet.id),
      this.sumActiveHolds('hostWalletId', wallet.id),
    ]);

    return Object.assign(wallet, { heldBalance, pendingEarnings });
  }

  private async sumActiveHolds(walletColumn: 'guestWalletId' | 'hostWalletId', walletId: string): Promise<string> {
    const result = await this.bookingHoldsRepo
      .createQueryBuilder('hold')
      .select('COALESCE(SUM(hold.amount), 0)', 'sum')
      .where(`hold.${walletColumn} = :walletId`, { walletId })
      .andWhere('hold.status = :status', { status: BookingHoldStatus.HELD })
      .getRawOne<{ sum: string }>();

    return Number(result?.sum ?? 0).toFixed(2);
  }

  // ─── TOP UP ──────────────────────────────────────────────────────────────────

  async topUp(
    userId: string,
    amount: number,
    paymentMethod: string,
  ): Promise<Wallet> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      let wallet = await qr.manager.findOne(Wallet, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!wallet) {
        wallet = qr.manager.create(Wallet, { userId });
        wallet = await qr.manager.save(wallet);
      }

      const balanceBefore = wallet.balance;
      const newBalance = (Number(wallet.balance) + amount).toFixed(2);
      wallet.balance = newBalance;
      await qr.manager.save(wallet);

      const txn = qr.manager.create(Transaction, {
        walletId: wallet.id,
        type: TransactionType.CREDIT,
        amount: amount.toFixed(2),
        balanceBefore,
        balanceAfter: newBalance,
        description: `Wallet top-up via ${paymentMethod}`,
        referenceType: TransactionReferenceType.TOP_UP,
        referenceId: null,
      });
      await qr.manager.save(txn);

      const invoice = qr.manager.create(Invoice, {
        transactionId: txn.id,
        userId,
        referenceType: InvoiceReferenceType.TOP_UP,
        referenceId: txn.id,
        amount: amount.toFixed(2),
        issuedAt: new Date(),
      });
      await qr.manager.save(invoice);

      await qr.commitTransaction();

      this.notificationsService
        .createAndSend(
          userId,
          NotificationType.PAYMENT_CONFIRMED,
          'Wallet topped up successfully',
          `SAR ${amount.toFixed(2)} has been added to your wallet.`,
          NotificationReferenceType.PAYMENT,
          invoice.id,
        )
        .catch(() => null);

      return wallet;
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  // ─── DEDUCT ──────────────────────────────────────────────────────────────────

  async deduct(
    userId: string,
    amount: number,
    referenceType: TransactionReferenceType,
    referenceId: string,
    description: string,
  ): Promise<Wallet> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const wallet = await qr.manager.findOne(Wallet, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!wallet || Number(wallet.balance) < amount) {
        throw new BadRequestException('Insufficient balance');
      }

      const balanceBefore = wallet.balance;
      const newBalance = (Number(wallet.balance) - amount).toFixed(2);
      wallet.balance = newBalance;
      await qr.manager.save(wallet);

      const txn = qr.manager.create(Transaction, {
        walletId: wallet.id,
        type: TransactionType.DEBIT,
        amount: amount.toFixed(2),
        balanceBefore,
        balanceAfter: newBalance,
        description,
        referenceType,
        referenceId,
      });
      await qr.manager.save(txn);

      const invoiceRefType = referenceType as unknown as InvoiceReferenceType;
      const invoice = qr.manager.create(Invoice, {
        transactionId: txn.id,
        userId,
        referenceType: invoiceRefType,
        referenceId,
        amount: amount.toFixed(2),
        issuedAt: new Date(),
      });
      await qr.manager.save(invoice);

      await qr.commitTransaction();
      return wallet;
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  // ─── QUERIES ─────────────────────────────────────────────────────────────────

  async getTransactions(
    userId: string,
    referenceType?: TransactionReferenceType,
    page = 1,
    limit = 20,
  ): Promise<{ data: Transaction[]; total: number; page: number }> {
    const wallet = await this.getOrCreateWallet(userId);

    const qb = this.transactionsRepo
      .createQueryBuilder('t')
      .where('t.walletId = :walletId', { walletId: wallet.id })
      .orderBy('t.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (referenceType) {
      qb.andWhere('t.referenceType = :referenceType', { referenceType });
    }

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page };
  }

  async getInvoices(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{ data: Invoice[]; total: number; page: number }> {
    const [data, total] = await this.invoicesRepo.findAndCount({
      where: { userId },
      order: { issuedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page };
  }
}
