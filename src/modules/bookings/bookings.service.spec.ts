/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
import { BadRequestException } from '@nestjs/common';
import { ListingStatus } from '../../common/enums/listing-status.enum';
import { ListingType } from '../../common/enums/listing-type.enum';
import { PropertyType } from '../../common/enums/property-type.enum';
import { ListingAvailability } from '../listings/entities/listing-availability.entity';
import { Listing } from '../listings/entities/listing.entity';
import {
  BookingHold,
  BookingHoldStatus,
} from '../wallet/entities/booking-hold.entity';
import { Invoice } from '../wallet/entities/invoice.entity';
import { Transaction } from '../wallet/entities/transaction.entity';
import { Wallet } from '../wallet/entities/wallet.entity';
import { BookingsService } from './bookings.service';
import { Booking } from './entities/booking.entity';

function makeService() {
  const bookingsRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };
  const availabilityRepo = { findOne: jest.fn(), find: jest.fn() };
  const listingsRepo = { findOne: jest.fn() };
  const bookingHoldsRepo = { find: jest.fn() };
  const dataSource = { transaction: jest.fn() };
  const notifications = {
    createAndSend: jest.fn().mockResolvedValue(undefined),
  };
  const service = new BookingsService(
    bookingsRepo as never,
    availabilityRepo as never,
    listingsRepo as never,
    bookingHoldsRepo as never,
    dataSource as never,
    notifications as never,
  );
  return {
    service,
    bookingsRepo,
    availabilityRepo,
    listingsRepo,
    dataSource,
    notifications,
  };
}

const dailyListing = {
  id: 'listing-1',
  ownerId: 'host-1',
  title: 'Daily stay',
  propertyType: PropertyType.APARTMENT,
  listingType: ListingType.RENT_SHORT,
  status: ListingStatus.PUBLISHED,
  totalPrice: '100.00',
  minNights: 1,
  maxGuests: 4,
} as Listing;

describe('BookingsService category and wallet-hold rules', () => {
  it('rejects event halls from availability, creation, and calendar endpoints', async () => {
    const { service, listingsRepo, availabilityRepo } = makeService();
    listingsRepo.findOne.mockResolvedValue({
      ...dailyListing,
      propertyType: PropertyType.EVENT_HALL,
    });

    await expect(
      service.checkAvailability('listing-1', {
        checkInDate: '2026-09-10',
        checkOutDate: '2026-09-11',
      }),
    ).rejects.toThrow('قاعات المناسبات متاحة للتواصل فقط');
    await expect(
      service.createBooking('guest-1', {
        listingId: 'listing-1',
        checkInDate: '2026-09-10',
        checkOutDate: '2026-09-11',
      }),
    ).rejects.toThrow('قاعات المناسبات متاحة للتواصل فقط');
    await expect(
      service.getListingCalendar('listing-1', 2026, 9),
    ).rejects.toThrow('قاعات المناسبات متاحة للتواصل فقط');
    expect(availabilityRepo.findOne).not.toHaveBeenCalled();
    expect(availabilityRepo.find).not.toHaveBeenCalled();
  });

  it('creates a daily-rental request and does not fail when notification delivery fails', async () => {
    const {
      service,
      listingsRepo,
      availabilityRepo,
      bookingsRepo,
      notifications,
    } = makeService();
    listingsRepo.findOne.mockResolvedValue(dailyListing);
    availabilityRepo.find.mockResolvedValue([]);
    bookingsRepo.create.mockImplementation((value) => ({
      id: 'booking-1',
      ...value,
    }));
    bookingsRepo.save.mockImplementation(async (value) => value);
    notifications.createAndSend.mockRejectedValue(
      new Error('push unavailable'),
    );

    const booking = await service.createBooking('guest-1', {
      listingId: 'listing-1',
      checkInDate: '2026-09-10',
      checkOutDate: '2026-09-12',
      guestCount: 2,
    });

    expect(booking.nights).toBe(2);
    expect(booking.totalPrice).toBe('200.00');
    expect(booking.eventDate).toBeNull();
    expect(booking.timeSlot).toBeNull();
  });

  it('rolls out no wallet writes when the guest has insufficient funds', async () => {
    const { service, dataSource } = makeService();
    const booking = {
      id: 'booking-1',
      listingId: 'listing-1',
      guestId: 'guest-1',
      ownerId: 'host-1',
      status: 'pending',
      totalPrice: '200.00',
      checkInDate: '2026-09-10',
      checkOutDate: '2026-09-12',
    } as Booking;
    const manager = {
      findOne: jest.fn(
        async (entity: unknown, options: { where?: { userId?: string } }) => {
          if (entity === Booking) return booking;
          if (entity === Listing) return dailyListing;
          if (entity === ListingAvailability) return null;
          if (entity === Wallet && options.where?.userId === 'guest-1') {
            return {
              id: 'guest-wallet',
              userId: 'guest-1',
              balance: '10.00',
              currency: 'SAR',
            };
          }
          return null;
        },
      ),
      save: jest.fn(),
    };
    dataSource.transaction.mockImplementation(async (callback) =>
      callback(manager),
    );

    await expect(service.confirmBooking('host-1', 'booking-1')).rejects.toThrow(
      'رصيد الضيف غير كافٍ',
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('atomically confirms, records the hold, blocks dates, and ignores post-commit notification failure', async () => {
    const { service, dataSource, notifications } = makeService();
    const booking = {
      id: 'booking-1',
      listingId: 'listing-1',
      guestId: 'guest-1',
      ownerId: 'host-1',
      status: 'pending',
      totalPrice: '200.00',
      checkInDate: '2026-09-10',
      checkOutDate: '2026-09-12',
    } as Booking;
    const guestWallet = {
      id: 'guest-wallet',
      userId: 'guest-1',
      balance: '500.00',
      currency: 'SAR',
    } as Wallet;
    const hostWallet = {
      id: 'host-wallet',
      userId: 'host-1',
      balance: '50.00',
      currency: 'SAR',
    } as Wallet;
    const createdEntities: unknown[] = [];
    const manager = {
      findOne: jest.fn(
        async (entity: unknown, options: { where?: { userId?: string } }) => {
          if (entity === Booking) return booking;
          if (entity === Listing) return dailyListing;
          if (entity === ListingAvailability) return null;
          if (entity === Wallet)
            return options.where?.userId === 'guest-1'
              ? guestWallet
              : hostWallet;
          return null;
        },
      ),
      create: jest.fn((entity: unknown, value: unknown) => {
        createdEntities.push(entity);
        return Array.isArray(value)
          ? value
          : { id: `created-${createdEntities.length}`, ...(value as object) };
      }),
      save: jest.fn(async (...args: unknown[]) =>
        args.length === 2 ? args[1] : args[0],
      ),
    };
    dataSource.transaction.mockImplementation(async (callback) =>
      callback(manager),
    );
    notifications.createAndSend.mockRejectedValue(
      new Error('push unavailable'),
    );

    const result = await service.confirmBooking('host-1', 'booking-1');

    expect(result.status).toBe('confirmed');
    expect(guestWallet.balance).toBe('300.00');
    expect(createdEntities).toEqual(
      expect.arrayContaining([
        Transaction,
        Invoice,
        BookingHold,
        ListingAvailability,
      ]),
    );
    expect(notifications.createAndSend).toHaveBeenCalledTimes(1);
  });

  it('converts a database uniqueness race into a date-conflict response', async () => {
    const { service, dataSource } = makeService();
    dataSource.transaction.mockRejectedValue({ code: '23505' });
    await expect(service.confirmBooking('host-1', 'booking-1')).rejects.toEqual(
      expect.any(BadRequestException),
    );
  });

  it('releases a hold once, credits the host, creates records, and completes the booking', async () => {
    const { service, dataSource, notifications } = makeService();
    const hold = {
      id: 'hold-1',
      bookingId: 'booking-1',
      hostWalletId: 'host-wallet',
      status: BookingHoldStatus.HELD,
      amount: '75.00',
    } as BookingHold;
    const booking = { id: 'booking-1', status: 'confirmed' } as Booking;
    const hostWallet = {
      id: 'host-wallet',
      userId: 'host-1',
      balance: '25.00',
    } as Wallet;
    const createdEntities: unknown[] = [];
    const manager = {
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === BookingHold) return hold;
        if (entity === Booking) return booking;
        if (entity === Wallet) return hostWallet;
        return null;
      }),
      create: jest.fn((entity: unknown, value: object) => {
        createdEntities.push(entity);
        return { id: `created-${createdEntities.length}`, ...value };
      }),
      save: jest.fn(async (value: unknown) => value),
    };
    dataSource.transaction.mockImplementation(async (callback) =>
      callback(manager),
    );

    const release = (
      service as unknown as { releaseBookingHold(id: string): Promise<void> }
    ).releaseBookingHold.bind(service);
    await release('hold-1');
    await release('hold-1');

    expect(hostWallet.balance).toBe('100.00');
    expect(hold.status).toBe(BookingHoldStatus.RELEASED);
    expect(booking.status).toBe('completed');
    expect(
      createdEntities.filter((entity) => entity === Transaction),
    ).toHaveLength(1);
    expect(createdEntities.filter((entity) => entity === Invoice)).toHaveLength(
      1,
    );
    expect(notifications.createAndSend).toHaveBeenCalledTimes(1);
  });
});
