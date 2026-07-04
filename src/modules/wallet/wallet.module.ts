import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingHold } from './entities/booking-hold.entity';
import { Invoice } from './entities/invoice.entity';
import { Transaction } from './entities/transaction.entity';
import { Wallet } from './entities/wallet.entity';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, Transaction, Invoice, BookingHold]),
    NotificationsModule,
  ],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
