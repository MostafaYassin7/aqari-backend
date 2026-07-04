import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ListingAvailability } from '../listings/entities/listing-availability.entity';
import { Listing } from '../listings/entities/listing.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingHold } from '../wallet/entities/booking-hold.entity';
import { Invoice } from '../wallet/entities/invoice.entity';
import { Transaction } from '../wallet/entities/transaction.entity';
import { Wallet } from '../wallet/entities/wallet.entity';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { Booking } from './entities/booking.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, ListingAvailability, Listing, Wallet, Transaction, Invoice, BookingHold]),
    NotificationsModule,
  ],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
