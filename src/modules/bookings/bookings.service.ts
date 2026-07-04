import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, EntityManager, In, LessThanOrEqual, Repository } from 'typeorm';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { ListingType } from '../../common/enums/listing-type.enum';
import { PropertyType } from '../../common/enums/property-type.enum';
import { NotificationReferenceType, NotificationType } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { ListingAvailability } from '../listings/entities/listing-availability.entity';
import { Listing } from '../listings/entities/listing.entity';
import { BookingHold, BookingHoldStatus } from '../wallet/entities/booking-hold.entity';
import { Invoice, InvoiceReferenceType } from '../wallet/entities/invoice.entity';
import { Transaction, TransactionReferenceType, TransactionType } from '../wallet/entities/transaction.entity';
import { Wallet } from '../wallet/entities/wallet.entity';
import { CheckAvailabilityDto } from './dto/check-availability.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { Booking } from './entities/booking.entity';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectRepository(Booking)
    private readonly bookingsRepo: Repository<Booking>,
    @InjectRepository(ListingAvailability)
    private readonly availabilityRepo: Repository<ListingAvailability>,
    @InjectRepository(Listing)
    private readonly listingsRepo: Repository<Listing>,
    @InjectRepository(BookingHold)
    private readonly bookingHoldsRepo: Repository<BookingHold>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Returns 'YYYY-MM-DD' strings from startDate UP TO BUT NOT INCLUDING endDate.
   * Example: ('2026-05-01', '2026-05-03') → ['2026-05-01', '2026-05-02']
   * Checkout date NOT blocked — next guest can check in.
   */
  private getDatesBetween(startDate: string, endDate: string): string[] {
    const dates: string[] = [];
    const current = new Date(startDate);
    const end = new Date(endDate);
    while (current < end) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }

  /**
   * Daily rental: checks blocked dates from checkInDate to checkOutDate (checkout NOT checked).
   * Event hall: checks if specific date+slot is blocked, also checks if full_day blocks the slot.
   */
  async checkAvailability(
    listingId: string,
    dto: CheckAvailabilityDto,
  ): Promise<{ isAvailable: boolean; blockedDates?: string[] }> {
    const listing = await this.listingsRepo.findOne({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('الإعلان غير موجود');

    if (listing.propertyType === PropertyType.EVENT_HALL) {
      if (!dto.eventDate || !dto.timeSlot) {
        throw new BadRequestException('تاريخ الحدث والفترة الزمنية مطلوبان');
      }

      const slotBlocked = await this.availabilityRepo.findOne({
        where: { listingId, date: dto.eventDate, timeSlot: dto.timeSlot },
      });
      const fullDayBlocked = await this.availabilityRepo.findOne({
        where: { listingId, date: dto.eventDate, timeSlot: 'full_day' },
      });

      if (slotBlocked || fullDayBlocked) return { isAvailable: false };
      return { isAvailable: true };
    }

    // Daily rental
    if (!dto.checkInDate || !dto.checkOutDate) {
      throw new BadRequestException('تاريخ الوصول والمغادرة مطلوبان');
    }

    if (new Date(dto.checkInDate) >= new Date(dto.checkOutDate)) {
      throw new BadRequestException('تاريخ المغادرة يجب أن يكون بعد تاريخ الوصول');
    }

    const dates = this.getDatesBetween(dto.checkInDate, dto.checkOutDate);

    const blockedRecords = await this.availabilityRepo.find({
      where: { listingId, date: In(dates) },
    });

    if (blockedRecords.length > 0) {
      return {
        isAvailable: false,
        blockedDates: blockedRecords.map((r) => r.date),
      };
    }
    return { isAvailable: true };
  }

  /**
   * Validates:
   *   1. Listing exists and is published
   *   2. Listing is bookable (event_hall OR rent_short)
   *   3. Owner cannot book own listing
   *   4. Required fields per listing type
   *   5. Dates are available
   *   6. Guest count within maxGuests
   *
   * Calculates total price automatically.
   * Does NOT deduct wallet — payment via chat.
   * Notifies owner of new request.
   */
  async createBooking(guestId: string, dto: CreateBookingDto): Promise<Booking> {
    // 1. Load listing
    const listing = await this.listingsRepo.findOne({
      where: { id: dto.listingId, status: ListingStatus.PUBLISHED },
    });
    if (!listing) throw new NotFoundException('الإعلان غير موجود أو غير متاح');

    // 2. Verify listing is bookable
    const isBookable = listing.propertyType === PropertyType.EVENT_HALL || listing.listingType === ListingType.RENT_SHORT;
    if (!isBookable) throw new BadRequestException('هذا الإعلان لا يدعم الحجز');

    // 3. Prevent self-booking
    if (listing.ownerId === guestId) throw new BadRequestException('لا يمكنك حجز إعلانك الخاص');

    // 4. Validate required fields per type
    if (listing.propertyType === PropertyType.EVENT_HALL) {
      if (!dto.eventDate) throw new BadRequestException('تاريخ الحدث مطلوب');
      if (!dto.timeSlot) throw new BadRequestException('الفترة الزمنية مطلوبة (صباحي/مسائي/يوم كامل)');
    } else {
      if (!dto.checkInDate) throw new BadRequestException('تاريخ الوصول مطلوب');
      if (!dto.checkOutDate) throw new BadRequestException('تاريخ المغادرة مطلوب');
    }

    // 5. Check availability
    const availability = await this.checkAvailability(dto.listingId, {
      checkInDate: dto.checkInDate,
      checkOutDate: dto.checkOutDate,
      eventDate: dto.eventDate,
      timeSlot: dto.timeSlot,
    });
    if (!availability.isAvailable) throw new BadRequestException('التواريخ المطلوبة غير متاحة');

    // 6. Calculate total price
    let totalPrice = 0;
    let nights: number | null = null;

    if (listing.propertyType === PropertyType.EVENT_HALL) {
      if (dto.timeSlot === 'full_day') {
        totalPrice = parseFloat(listing.totalPrice);
      } else {
        if (!listing.pricePerHalfDay) throw new BadRequestException('سعر الفترة غير محدد، تواصل مع المالك');
        totalPrice = parseFloat(listing.pricePerHalfDay);
      }
    } else {
      const dates = this.getDatesBetween(dto.checkInDate!, dto.checkOutDate!);
      nights = dates.length;
      if (listing.minNights && nights < listing.minNights) {
        throw new BadRequestException(
          `الحد الأدنى للإقامة ${listing.minNights} ${listing.minNights === 1 ? 'ليلة' : 'ليالٍ'}`,
        );
      }
      totalPrice = parseFloat(listing.totalPrice) * nights;
    }

    // 7. Validate guest count
    if (dto.guestCount && listing.maxGuests && dto.guestCount > listing.maxGuests) {
      throw new BadRequestException(`عدد الضيوف يتجاوز الطاقة الاستيعابية (${listing.maxGuests} ضيف كحد أقصى)`);
    }

    // 8. Create and save
    const booking = this.bookingsRepo.create({
      listingId: dto.listingId,
      guestId,
      ownerId: listing.ownerId,
      checkInDate: dto.checkInDate ?? null,
      checkOutDate: dto.checkOutDate ?? null,
      nights,
      eventDate: dto.eventDate ?? null,
      timeSlot: dto.timeSlot ?? null,
      guestCount: dto.guestCount ?? null,
      totalPrice: totalPrice.toFixed(2),
      status: 'pending',
      notes: dto.notes ?? null,
    });
    await this.bookingsRepo.save(booking);

    // 9. Notify owner
    await this.notificationsService.createAndSend(
      listing.ownerId,
      NotificationType.BOOKING_UPDATE,
      'طلب حجز جديد',
      `لديك طلب حجز جديد على "${listing.title}"`,
      NotificationReferenceType.LISTING,
      listing.id,
    );

    return booking;
  }

  /**
   * Owner confirms pending booking.
   * Deducts guest wallet, creates booking hold, and blocks dates atomically.
   * Notifies guest.
   */
  async confirmBooking(ownerId: string, bookingId: string): Promise<Booking> {
    let booking: Booking;
    try {
      booking = await this.dataSource.transaction(async (manager) => {
        const lockedBooking = await manager.findOne(Booking, {
          where: { id: bookingId, ownerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!lockedBooking) throw new NotFoundException('الحجز غير موجود أو لا يمكن تأكيده');
        if (lockedBooking.status !== 'pending') throw new BadRequestException('لا يمكن تأكيد هذا الحجز');

        await this.ensureAvailableForConfirmation(manager, lockedBooking);

        const amount = Number(lockedBooking.totalPrice);
        if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('قيمة الحجز غير صحيحة');

        const guestWallet = await manager.findOne(Wallet, {
          where: { userId: lockedBooking.guestId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!guestWallet || Number(guestWallet.balance) < amount) {
          throw new BadRequestException('رصيد الضيف غير كافٍ لتأكيد الحجز');
        }

        let hostWallet = await manager.findOne(Wallet, {
          where: { userId: lockedBooking.ownerId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!hostWallet) {
          hostWallet = manager.create(Wallet, { userId: lockedBooking.ownerId });
          hostWallet = await manager.save(hostWallet);
        }

        const guestBalanceBefore = guestWallet.balance;
        const guestBalanceAfter = (Number(guestWallet.balance) - amount).toFixed(2);
        guestWallet.balance = guestBalanceAfter;
        await manager.save(guestWallet);

        const guestTxn = manager.create(Transaction, {
          walletId: guestWallet.id,
          type: TransactionType.DEBIT,
          amount: amount.toFixed(2),
          balanceBefore: guestBalanceBefore,
          balanceAfter: guestBalanceAfter,
          description: `Booking hold for reservation ${lockedBooking.id}`,
          referenceType: TransactionReferenceType.BOOKING,
          referenceId: lockedBooking.id,
        });
        await manager.save(guestTxn);

        const guestInvoice = manager.create(Invoice, {
          transactionId: guestTxn.id,
          userId: lockedBooking.guestId,
          referenceType: InvoiceReferenceType.BOOKING,
          referenceId: lockedBooking.id,
          amount: amount.toFixed(2),
          issuedAt: new Date(),
        });
        await manager.save(guestInvoice);

        const hold = manager.create(BookingHold, {
          bookingId: lockedBooking.id,
          guestWalletId: guestWallet.id,
          hostWalletId: hostWallet.id,
          amount: amount.toFixed(2),
          currency: guestWallet.currency ?? hostWallet.currency ?? 'SAR',
          status: BookingHoldStatus.HELD,
          releaseAt: this.calculateReleaseAt(lockedBooking),
        });
        await manager.save(hold);

        await this.blockDatesWithManager(manager, lockedBooking);

        lockedBooking.status = 'confirmed';
        return manager.save(lockedBooking);
      });
    } catch (err) {
      if (typeof err === 'object' && err && 'code' in err && err.code === '23505') {
        throw new BadRequestException('التواريخ المطلوبة غير متاحة');
      }
      throw err;
    }

    await this.notificationsService.createAndSend(
      booking.guestId,
      NotificationType.BOOKING_UPDATE,
      'تم تأكيد حجزك ✅',
      'تم تأكيد حجزك وتم حجز مبلغ الحجز من محفظتك. سيتم تحويل المبلغ للمضيف بعد 7 أيام من انتهاء الحجز.',
      NotificationReferenceType.BOOKING,
      booking.id,
    );

    return booking;
  }

  /**
   * Owner declines pending booking.
   * No money was moved so nothing to reverse.
   */
  async declineBooking(ownerId: string, bookingId: string, reason?: string): Promise<Booking> {
    const booking = await this.bookingsRepo.findOne({
      where: { id: bookingId, ownerId, status: 'pending' },
    });
    if (!booking) throw new NotFoundException('الحجز غير موجود أو لا يمكن رفضه');

    booking.status = 'cancelled';
    await this.bookingsRepo.save(booking);

    await this.notificationsService.createAndSend(
      booking.guestId,
      NotificationType.BOOKING_UPDATE,
      'تم رفض طلب حجزك',
      reason ?? 'تم رفض طلب الحجز من قِبل المضيف',
      NotificationReferenceType.BOOKING,
      booking.id,
    );

    return booking;
  }

  /**
   * Guest cancels their own pending booking.
   * After confirmation guest must contact owner via chat.
   */
  async cancelBooking(guestId: string, bookingId: string): Promise<Booking> {
    const booking = await this.bookingsRepo.findOne({
      where: { id: bookingId, guestId, status: 'pending' },
    });
    if (!booking) {
      throw new NotFoundException('الحجز غير موجود أو لا يمكن إلغاؤه. إذا كان مؤكداً تواصل مع المضيف.');
    }

    booking.status = 'cancelled';
    await this.bookingsRepo.save(booking);

    await this.notificationsService.createAndSend(
      booking.ownerId,
      NotificationType.BOOKING_UPDATE,
      'تم إلغاء طلب حجز',
      'قام الضيف بإلغاء طلب الحجز',
      NotificationReferenceType.BOOKING,
      booking.id,
    );

    return booking;
  }

  private calculateReleaseAt(booking: Booking): Date {
    const releaseBaseDate = booking.checkOutDate ?? booking.eventDate;
    if (!releaseBaseDate) throw new BadRequestException('تاريخ انتهاء الحجز غير محدد');

    const releaseAt = new Date(`${releaseBaseDate}T00:00:00.000Z`);
    releaseAt.setUTCDate(releaseAt.getUTCDate() + 7);
    return releaseAt;
  }

  private async ensureAvailableForConfirmation(manager: EntityManager, booking: Booking): Promise<void> {
    if (booking.eventDate) {
      const timeSlots = booking.timeSlot === 'full_day'
        ? ['full_day', 'morning', 'evening']
        : [booking.timeSlot, 'full_day'];

      const blocked = await manager.findOne(ListingAvailability, {
        where: {
          listingId: booking.listingId,
          date: booking.eventDate,
          timeSlot: In(timeSlots.filter((slot): slot is string => Boolean(slot))),
        },
      });

      if (blocked) throw new BadRequestException('التواريخ المطلوبة غير متاحة');
      return;
    }

    if (!booking.checkInDate || !booking.checkOutDate) {
      throw new BadRequestException('تاريخ الوصول والمغادرة مطلوبان');
    }

    const dates = this.getDatesBetween(booking.checkInDate, booking.checkOutDate);
    const blocked = await manager.findOne(ListingAvailability, {
      where: { listingId: booking.listingId, date: In(dates) },
    });

    if (blocked) throw new BadRequestException('التواريخ المطلوبة غير متاحة');
  }

  private buildAvailabilityRecords(booking: Booking): Partial<ListingAvailability>[] {
    if (booking.eventDate) {
      if (booking.timeSlot === 'full_day') {
        return ['full_day', 'morning', 'evening'].map((slot) => ({
          listingId: booking.listingId,
          date: booking.eventDate!,
          timeSlot: slot,
          blockReason: 'booked',
          bookingId: booking.id,
        }));
      }

      return [{
        listingId: booking.listingId,
        date: booking.eventDate,
        timeSlot: booking.timeSlot,
        blockReason: 'booked',
        bookingId: booking.id,
      }];
    }

    const dates = this.getDatesBetween(booking.checkInDate!, booking.checkOutDate!);
    return dates.map((date) => ({
      listingId: booking.listingId,
      date,
      timeSlot: null,
      blockReason: 'booked',
      bookingId: booking.id,
    }));
  }

  private async blockDatesWithManager(manager: EntityManager, booking: Booking): Promise<void> {
    const records = this.buildAvailabilityRecords(booking);
    await manager.save(ListingAvailability, manager.create(ListingAvailability, records));
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleBookingHoldReleases(): Promise<void> {
    await this.releaseDueBookingHolds();
  }

  async releaseDueBookingHolds(): Promise<void> {
    const dueHolds = await this.bookingHoldsRepo.find({
      where: {
        status: BookingHoldStatus.HELD,
        releaseAt: LessThanOrEqual(new Date()),
      },
      take: 100,
    });

    if (dueHolds.length === 0) return;
    this.logger.log(`Releasing ${dueHolds.length} booking holds`);

    await Promise.allSettled(dueHolds.map((hold) => this.releaseBookingHold(hold.id)));
  }

  private async releaseBookingHold(holdId: string): Promise<void> {
    const result = await this.dataSource.transaction(async (manager) => {
      const hold = await manager.findOne(BookingHold, {
        where: { id: holdId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!hold || hold.status !== BookingHoldStatus.HELD) return null;

      const hostWallet = await manager.findOne(Wallet, {
        where: { id: hold.hostWalletId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!hostWallet) {
        hold.status = BookingHoldStatus.DISPUTED;
        hold.disputedAt = new Date();
        await manager.save(hold);
        return null;
      }

      const amount = Number(hold.amount);
      const balanceBefore = hostWallet.balance;
      const balanceAfter = (Number(hostWallet.balance) + amount).toFixed(2);
      hostWallet.balance = balanceAfter;
      await manager.save(hostWallet);

      const hostTxn = manager.create(Transaction, {
        walletId: hostWallet.id,
        type: TransactionType.CREDIT,
        amount: amount.toFixed(2),
        balanceBefore,
        balanceAfter,
        description: `Booking payout for reservation ${hold.bookingId}`,
        referenceType: TransactionReferenceType.BOOKING,
        referenceId: hold.bookingId,
      });
      await manager.save(hostTxn);

      const hostInvoice = manager.create(Invoice, {
        transactionId: hostTxn.id,
        userId: hostWallet.userId,
        referenceType: InvoiceReferenceType.BOOKING,
        referenceId: hold.bookingId,
        amount: amount.toFixed(2),
        issuedAt: new Date(),
      });
      await manager.save(hostInvoice);

      hold.status = BookingHoldStatus.RELEASED;
      hold.releasedAt = new Date();
      await manager.save(hold);

      return { hostUserId: hostWallet.userId, bookingId: hold.bookingId, amount };
    });

    if (!result) return;

    this.notificationsService
      .createAndSend(
        result.hostUserId,
        NotificationType.PAYMENT_CONFIRMED,
        'تم تحويل مبلغ الحجز',
        `تم تحويل SAR ${result.amount.toFixed(2)} إلى محفظتك بعد انتهاء فترة الحجز.`,
        NotificationReferenceType.BOOKING,
        result.bookingId,
      )
      .catch(() => null);
  }

  /**
   * Returns all blocked dates for a listing in a month.
   * Public endpoint — no auth needed.
   */
  async getListingCalendar(
    listingId: string,
    year: number,
    month: number,
  ): Promise<{ blockedDates: { date: string; timeSlot: string | null }[] }> {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const blocked = await this.availabilityRepo.find({
      where: { listingId, date: Between(startDate, endDate) },
      order: { date: 'ASC' },
    });

    return {
      blockedDates: blocked.map((b) => ({
        date: b.date,
        timeSlot: b.timeSlot,
      })),
    };
  }

  async getMyBookingsAsGuest(
    guestId: string,
    page = 1,
    limit = 20,
  ): Promise<{ data: Booking[]; total: number; pages: number }> {
    const [data, total] = await this.bookingsRepo.findAndCount({
      where: { guestId },
      relations: ['listing'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, pages: Math.ceil(total / limit) };
  }

  async getMyBookingsAsOwner(
    ownerId: string,
    page = 1,
    limit = 20,
  ): Promise<{ data: Booking[]; total: number; pages: number }> {
    const [data, total] = await this.bookingsRepo.findAndCount({
      where: { ownerId },
      relations: ['listing'],
      order: { status: 'ASC', createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, pages: Math.ceil(total / limit) };
  }
}
