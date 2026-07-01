import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Listing } from './listing.entity';

// Stores blocked dates for bookable listings.
// One record = one blocked date/slot.
// UNIQUE constraint prevents double-booking.
@Entity('listing_availability')
@Index('UQ_listing_availability_daily', ['listingId', 'date'], {
  unique: true,
  where: '"timeSlot" IS NULL',
})
@Index('UQ_listing_availability_hall', ['listingId', 'date', 'timeSlot'], {
  unique: true,
  where: '"timeSlot" IS NOT NULL',
})
@Index(['listingId'])
@Index(['date'])
export class ListingAvailability extends BaseEntity {
  // معرّف الإعلان
  @Column({ type: 'uuid' })
  listingId!: string;

  @ManyToOne(() => Listing, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listingId' })
  listing!: Listing;

  // التاريخ المحجوز — 'YYYY-MM-DD'
  @Column({ type: 'date' })
  date!: string;

  // الفترة الزمنية — للقاعات فقط
  // 'morning' | 'evening' | 'full_day' | null
  // null for daily rentals (whole day blocked)
  @Column({ type: 'varchar', nullable: true })
  timeSlot!: string | null;

  // سبب الإغلاق
  // 'booked'        → blocked by confirmed booking
  // 'owner_blocked' → manually blocked by owner
  @Column({ type: 'varchar', default: 'booked' })
  blockReason!: string;

  // معرّف الحجز المرتبط (null for owner_blocked)
  @Column({ type: 'uuid', nullable: true })
  bookingId!: string | null;
}
