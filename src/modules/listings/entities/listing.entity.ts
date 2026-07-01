import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Facade } from '../../../common/enums/facade.enum';
import { ListingStatus } from '../../../common/enums/listing-status.enum';
import { ListingType } from '../../../common/enums/listing-type.enum';
import { PropertyType } from '../../../common/enums/property-type.enum';
import { UsageType } from '../../../common/enums/usage-type.enum';
import { User } from '../../users/entities/user.entity';
import { ListingCategory } from './listing-category.entity';
import { ListingMedia } from './listing-media.entity';

@Entity('listings')
@Index(['city'])
@Index(['propertyType'])
@Index(['listingType'])
@Index(['status'])
@Index(['totalPrice'])
@Index(['area'])
@Index(['bedrooms'])
@Index(['ownerId'])
export class Listing extends BaseEntity {
  // ─── IDENTITY ────────────────────────────────────────────────────────────────

  @Column({ type: 'varchar' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'enum', enum: ListingStatus, default: ListingStatus.PENDING })
  status!: ListingStatus;

  @Column({ type: 'integer', default: 0 })
  viewCount!: number;

  @Column({ type: 'integer', default: 0 })
  messageCount!: number;

  @Column({ type: 'varchar', unique: true })
  adNumber!: string;

  // ─── CATEGORY (flat for Algolia) ─────────────────────────────────────────────

  @Column({ type: 'uuid' })
  categoryId!: string;

  @ManyToOne(() => ListingCategory, { eager: true })
  @JoinColumn({ name: 'categoryId' })
  category!: ListingCategory;

  @Column({ type: 'enum', enum: PropertyType })
  propertyType!: PropertyType;

  @Column({ type: 'enum', enum: ListingType })
  listingType!: ListingType;

  // ─── PRICING ─────────────────────────────────────────────────────────────────

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  totalPrice!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  pricePerMeter!: string | null;

  @Column({ type: 'boolean', default: false })
  commission!: boolean;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  commissionPercent!: string | null;

  // ─── PROPERTY SPECS ───────────────────────────────────────────────────────────

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  area!: string;

  @Column({ type: 'enum', enum: UsageType, default: UsageType.RESIDENTIAL })
  usageType!: UsageType;

  @Column({ type: 'integer', nullable: true })
  bedrooms!: number | null;

  @Column({ type: 'integer', nullable: true })
  livingRooms!: number | null;

  @Column({ type: 'integer', nullable: true })
  bathrooms!: number | null;

  @Column({ type: 'enum', enum: Facade, nullable: true })
  facade!: Facade | null;

  @Column({ type: 'integer', nullable: true })
  floor!: number | null;

  @Column({ type: 'integer', nullable: true })
  propertyAge!: number | null;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  streetWidth!: string | null;

  // ─── FEATURES ─────────────────────────────────────────────────────────────────

  @Column({ type: 'boolean', default: false })
  hasWater!: boolean;

  @Column({ type: 'boolean', default: false })
  hasElectricity!: boolean;

  @Column({ type: 'boolean', default: false })
  hasSewage!: boolean;

  @Column({ type: 'boolean', default: false })
  hasPrivateRoof!: boolean;

  @Column({ type: 'boolean', default: false })
  isInVilla!: boolean;

  @Column({ type: 'boolean', default: false })
  hasTwoEntrances!: boolean;

  @Column({ type: 'boolean', default: false })
  hasSpecialEntrance!: boolean;

  // ─── BOOKABLE LISTING FIELDS ──────────────────────────────────────────────────
  // Used when listingType = 'rent_short' OR propertyType = 'event_hall'

  // الطاقة الاستيعابية القصوى
  // Required for event halls, optional for daily rentals
  @Column({ type: 'int', nullable: true })
  maxGuests!: number | null;

  // وقت تسجيل الوصول — "HH:mm" e.g. "14:00" — daily rentals only
  @Column({ type: 'varchar', length: 5, nullable: true })
  checkInTime!: string | null;

  // وقت تسجيل المغادرة — "HH:mm" e.g. "12:00" — daily rentals only
  @Column({ type: 'varchar', length: 5, nullable: true })
  checkOutTime!: string | null;

  // الحد الأدنى لعدد الليالي — daily rentals only
  @Column({ type: 'int', nullable: true, default: 1 })
  minNights!: number | null;

  // ─── EVENT HALL SPECIFIC ──────────────────────────────────────────────────────
  // Only when propertyType = 'event_hall'

  // سعر الفترة الصباحية أو المسائية — totalPrice = full day, this column = half day
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  pricePerHalfDay!: string | null;

  // الخدمات المشمولة في السعر — stored as JSONB array of strings
  // Allowed values: 'catering', 'sound_system', 'projector', 'decoration', 'security', 'parking'
  @Column({ type: 'jsonb', nullable: true })
  includedServices!: string[] | null;

  // ─── CHECKLIST ───────────────────────────────────────────────────────────────

  @Column({ type: 'boolean', default: false })
  isFurnished!: boolean;

  @Column({ type: 'boolean', default: false })
  hasKitchen!: boolean;

  @Column({ type: 'boolean', default: false })
  hasExtraUnit!: boolean;

  @Column({ type: 'boolean', default: false })
  hasCarEntrance!: boolean;

  @Column({ type: 'boolean', default: false })
  hasElevator!: boolean;

  // ─── LOCATION ────────────────────────────────────────────────────────────────

  @Column({ type: 'varchar' })
  city!: string;

  @Column({ type: 'varchar', nullable: true })
  district!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  latitude!: string;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  longitude!: string;

  @Column({ type: 'varchar', nullable: true })
  address!: string | null;

  // ─── PROMOTION ───────────────────────────────────────────────────────────────

  @Column({ type: 'boolean', default: false })
  isPromoted!: boolean;

  @Column({ type: 'boolean', default: false })
  isGolden!: boolean;

  @Column({ type: 'varchar', nullable: true })
  promotionType!: 'featured' | 'golden' | 'buyers_alert' | 'social_media' | null;

  @Column({ type: 'timestamp', nullable: true })
  promotionExpiresAt!: Date | null;

  // ─── COVER ───────────────────────────────────────────────────────────────────

  @Column({ type: 'varchar', nullable: true })
  coverPhoto!: string | null;

  // ─── LICENSE ────────────────────────────────────────────────────────────────

  // معرّف ترخيص الإعلان العقاري
  // UUID of the PropertyAdvertisementLicense record linked to this listing.
  // NULL for host listings (no license required).
  // NULL until the listing is created and linked in the final submit step.
  // No FK constraint — stored as a plain UUID string.
  @Column({ type: 'uuid', nullable: true })
  licenseId!: string | null;

  // ─── OWNERSHIP ───────────────────────────────────────────────────────────────

  @Column({ type: 'uuid' })
  ownerId!: string;

  @ManyToOne(() => User, { lazy: true })
  @JoinColumn({ name: 'ownerId' })
  owner!: Promise<User>;

  // ─── RELATIONS ───────────────────────────────────────────────────────────────

  @OneToMany(() => ListingMedia, (media) => media.listing, { lazy: true })
  media!: Promise<ListingMedia[]>;
}
