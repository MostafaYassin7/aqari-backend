import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Listing } from '../../listings/entities/listing.entity';

@Entity('bookings')
@Index(['listingId'])
@Index(['guestId'])
@Index(['ownerId'])
@Index(['status'])
export class Booking extends BaseEntity {
  // معرّف الإعلان المحجوز
  @Column({ type: 'uuid' })
  listingId!: string;

  @ManyToOne(() => Listing, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listingId' })
  listing!: Listing;

  // معرّف الضيف (المستخدم الذي يحجز)
  @Column({ type: 'uuid' })
  guestId!: string;

  // معرّف المضيف — copied from listing.ownerId
  @Column({ type: 'uuid' })
  ownerId!: string;

  // ── DAILY RENTAL FIELDS ─────────────────────────────────────────────────────
  // Set when listingType = 'rent_short' AND propertyType != 'event_hall'

  // تاريخ تسجيل الوصول — 'YYYY-MM-DD'
  @Column({ type: 'date', nullable: true })
  checkInDate!: string | null;

  // تاريخ تسجيل المغادرة — 'YYYY-MM-DD'
  @Column({ type: 'date', nullable: true })
  checkOutDate!: string | null;

  // عدد الليالي — calculated in createBooking()
  @Column({ type: 'int', nullable: true })
  nights!: number | null;

  // ── EVENT HALL FIELDS ───────────────────────────────────────────────────────
  // Set when propertyType = 'event_hall'

  // تاريخ الحدث — 'YYYY-MM-DD'
  @Column({ type: 'date', nullable: true })
  eventDate!: string | null;

  // الفترة الزمنية: 'morning' | 'evening' | 'full_day'
  @Column({ type: 'varchar', nullable: true })
  timeSlot!: string | null;

  // ── SHARED FIELDS ────────────────────────────────────────────────────────────

  // عدد الضيوف (اختياري)
  @Column({ type: 'int', nullable: true })
  guestCount!: number | null;

  // السعر الإجمالي — calculated and stored
  // Payment arranged via chat, not collected here
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalPrice!: string;

  // حالة الحجز
  // 'pending'   → في انتظار تأكيد المضيف
  // 'confirmed' → مؤكد
  // 'cancelled' → ملغي
  // 'completed' → مكتمل
  @Column({ type: 'varchar', default: 'pending' })
  status!: string;

  // ملاحظات الضيف
  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}
