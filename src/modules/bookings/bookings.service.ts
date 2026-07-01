import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { ListingType } from '../../common/enums/listing-type.enum';
import { PropertyType } from '../../common/enums/property-type.enum';
import { NotificationReferenceType, NotificationType } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { ListingAvailability } from '../listings/entities/listing-availability.entity';
import { Listing } from '../listings/entities/listing.entity';
import { CheckAvailabilityDto } from './dto/check-availability.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { Booking } from './entities/booking.entity';

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingsRepo: Repository<Booking>,
    @InjectRepository(ListingAvailability)
    private readonly availabilityRepo: Repository<ListingAvailability>,
    @InjectRepository(Listing)
    private readonly listingsRepo: Repository<Listing>,
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
   * Blocks dates in listing_availability.
   * No wallet deduction — payment via chat.
   * Notifies guest.
   */
  async confirmBooking(ownerId: string, bookingId: string): Promise<Booking> {
    const booking = await this.bookingsRepo.findOne({
      where: { id: bookingId, ownerId, status: 'pending' },
    });
    if (!booking) throw new NotFoundException('الحجز غير موجود أو لا يمكن تأكيده');

    booking.status = 'confirmed';
    await this.bookingsRepo.save(booking);

    await this.blockDates(booking);

    await this.notificationsService.createAndSend(
      booking.guestId,
      NotificationType.BOOKING_UPDATE,
      'تم تأكيد حجزك ✅',
      'تم تأكيد حجزك. تواصل مع المضيف عبر المحادثة لترتيب تفاصيل الدفع والوصول.',
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

  /**
   * Called by confirmBooking() only.
   *
   * Determines type by booking.eventDate:
   *   eventDate set   → event hall → block slot
   *   checkInDate set → daily rental → block nights
   *
   * full_day event hall: blocks morning + evening too.
   * Daily rental: blocks checkIn through checkOut-1.
   */
  private async blockDates(booking: Booking): Promise<void> {
    if (booking.eventDate) {
      // Event hall
      const records: Partial<ListingAvailability>[] = [];

      if (booking.timeSlot === 'full_day') {
        // Block all three slots
        for (const slot of ['full_day', 'morning', 'evening']) {
          records.push({
            listingId: booking.listingId,
            date: booking.eventDate,
            timeSlot: slot,
            blockReason: 'booked',
            bookingId: booking.id,
          });
        }
      } else {
        // Block requested slot only
        records.push({
          listingId: booking.listingId,
          date: booking.eventDate,
          timeSlot: booking.timeSlot,
          blockReason: 'booked',
          bookingId: booking.id,
        });
      }

      await this.availabilityRepo.save(this.availabilityRepo.create(records));
    } else {
      // Daily rental
      const dates = this.getDatesBetween(booking.checkInDate!, booking.checkOutDate!);

      const records = dates.map((date) =>
        this.availabilityRepo.create({
          listingId: booking.listingId,
          date,
          timeSlot: null,
          blockReason: 'booked',
          bookingId: booking.id,
        }),
      );
      await this.availabilityRepo.save(records);
    }
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
