import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

/**
 * PropertyAdvertisementLicense — ترخيص إعلان عقاري
 *
 * Stores the legal identity and authorization documents that a user
 * must submit before their real estate listing can be published
 * on the Aqar platform, as required by the General Real Estate
 * Authority of Saudi Arabia (الهيئة العامة للعقار).
 *
 * Every listing by an owner, agent, or broker must have an approved
 * license record. Hosts are exempt — their listings publish directly.
 *
 * Lifecycle:
 *   1. User submits the license form → record created, listingId = null
 *   2. User completes the listing form → listingId linked
 *   3. Admin reviews → reviewStatus set to 'approved' or 'rejected'
 *   4. On approval  → linked listing status set to PUBLISHED + Algolia sync
 *   5. On rejection → linked listing status set to PAUSED  + user notified
 */
@Entity('property_advertisement_licenses')
@Index(['advertiserUserId'])
@Index(['reviewStatus'])
@Index(['listingId'])
export class PropertyAdvertisementLicense extends BaseEntity {
  // ── SHARED COLUMNS (all advertiser types) ────────────────────────────────────

  // معرّف المستخدم صاحب الطلب
  // UUID of the user who submitted this license request.
  // FK to users table (stored as plain UUID — no constraint enforced).
  // Used by: all advertiser types
  // Required: YES
  @Column({ type: 'uuid' })
  advertiserUserId!: string;

  // معرّف الإعلان المرتبط
  // UUID of the listing that this license covers.
  // NULL when the license is first created (listing not yet submitted).
  // Gets linked when the user completes and submits the listing form.
  // Used by: all advertiser types
  // Required: NO (nullable until listing is created)
  @Column({ type: 'uuid', nullable: true })
  listingId!: string | null;

  // نوع المُعلن
  // Identifies the legal role of the person advertising the property.
  // Determines which fields in this record are required and validated.
  // Allowed values:
  //   'owner'  → مالك   — property owner listing their own property
  //   'agent'  → وكيل   — person acting on behalf of owner via POA
  //   'broker' → مسوق عقاري — licensed broker with FAL license
  //   'host'   → مضيف   — short-term rental host (no license needed)
  // Used by: all advertiser types
  // Required: YES
  @Column({ type: 'varchar' })
  advertiserType!: string;

  // حالة مراجعة الطلب
  // Admin review decision for this license request.
  // Allowed values:
  //   'pending'  → في انتظار المراجعة — awaiting admin action
  //   'approved' → تمت الموافقة       — license accepted, listing goes live
  //   'rejected' → مرفوض              — license denied, listing paused
  // Used by: all advertiser types
  // Required: YES (defaults to 'pending' on creation)
  @Column({ type: 'varchar', default: 'pending' })
  reviewStatus!: string;

  // سبب الرفض
  // Human-readable reason written by the admin when rejecting a license.
  // Sent to the user as a push notification body.
  // Used by: all advertiser types
  // Required: YES when reviewStatus = 'rejected', otherwise NULL
  @Column({ type: 'text', nullable: true })
  rejectionReason!: string | null;

  // تاريخ ووقت المراجعة
  // Timestamp of when the admin set reviewStatus to 'approved' or 'rejected'.
  // Used by: all advertiser types
  // Required: NO (set automatically when admin reviews)
  @Column({ type: 'timestamp', nullable: true })
  reviewedAt!: Date | null;

  // الأدمن المسؤول عن المراجعة
  // UUID of the admin user who approved or rejected this license.
  // Used by: all advertiser types
  // Required: NO (set automatically when admin reviews)
  @Column({ type: 'uuid', nullable: true })
  reviewedByAdminId!: string | null;

  // ── PROPERTY OWNERSHIP DOCUMENT ──────────────────────────────────────────────
  // الأقسام التالية تخص وثيقة ملكية العقار
  // Used by: advertiserType = 'owner' AND 'agent'

  // نوع وثيقة ملكية العقار
  // The type of official document that proves property ownership.
  // Allowed values:
  //   'electronic_deed' → صك إلكتروني    — electronic title deed
  //   'property_number' → رقم العقار     — property number from REGA
  //   'land_registry'   → رقم السجل العيني — land registry number
  //   'other'           → غير ذلك         — other document type
  // Used by: advertiserType = 'owner', 'agent'
  // Required: YES for owner and agent
  @Column({ type: 'varchar', nullable: true })
  ownershipDocumentType!: string | null;

  // رقم الوثيقة
  // The actual number of the ownership document selected above.
  // e.g. رقم الصك أو رقم العقار أو رقم السجل العيني
  // Used by: advertiserType = 'owner', 'agent'
  // Required: YES for owner and agent
  @Column({ type: 'varchar', nullable: true })
  ownershipDocumentNumber!: string | null;

  // ── PROPERTY OWNER INFO ───────────────────────────────────────────────────────
  // معلومات مالك العقار
  // Used by: advertiserType = 'owner', 'agent', 'broker'
  // (broker needs owner ID to prove authorization)

  // نوع هوية مالك العقار
  // The type of identity document used to identify the property owner.
  // Allowed values:
  //   'national_id'             → هوية وطنية  — for individual Saudi citizens
  //   'commercial_registration' → سجل تجاري   — for companies/establishments
  //   'unified_700'             → الرقم الموحد 700 — unified commercial number
  // Used by: advertiserType = 'owner', 'agent', 'broker'
  // Required: YES for owner, agent, broker
  @Column({ type: 'varchar', nullable: true })
  propertyOwnerIdType!: string | null;

  // رقم هوية المالك
  // The actual identity document number of the property owner.
  // Used by: advertiserType = 'owner', 'agent', 'broker'
  // Required: YES for owner, agent, broker
  @Column({ type: 'varchar', nullable: true })
  propertyOwnerIdNumber!: string | null;

  // تاريخ ميلاد المالك
  // Date of birth of the property owner.
  // Required for individuals (propertyOwnerIdType = 'national_id') only.
  // NOT required when propertyOwnerIdType = 'commercial_registration' or 'unified_700'.
  // Used by: advertiserType = 'owner', 'agent', 'broker' (individuals only)
  // Required: Conditional — only when propertyOwnerIdType = 'national_id'
  @Column({ type: 'date', nullable: true })
  propertyOwnerBirthDate!: string | null;

  // هل التاريخ المُدخَل بالتقويم الهجري؟
  // Indicates whether propertyOwnerBirthDate is entered in the Hijri calendar.
  // true  = هجري  (Hijri/Islamic calendar)
  // false = ميلادي (Gregorian calendar)
  // Used by: advertiserType = 'owner', 'agent', 'broker'
  // Required: NO (defaults to true — Hijri is standard in Saudi Arabia)
  @Column({ type: 'boolean', default: true })
  isHijriCalendar!: boolean;

  // رقم جوال المالك
  // Mobile phone number of the property owner.
  // Used by: advertiserType = 'owner', 'agent'
  // Required: YES for owner and agent
  @Column({ type: 'varchar', nullable: true })
  propertyOwnerPhone!: string | null;

  // رقم هوية أحد الملاك
  // National ID of one of the co-owners, used when the property has
  // multiple owners and the agent represents one of them.
  // Used by: advertiserType = 'agent' (when property has multiple owners)
  // Required: NO (only when multiple owners exist)
  @Column({ type: 'varchar', nullable: true })
  oneOfOwnersNationalId!: string | null;

  // ── ESTABLISHMENT INFO ────────────────────────────────────────────────────────
  // معلومات المنشأة (عند كون المالك شركة أو مؤسسة)

  // رقم السجل التجاري للمنشأة المالكة للعقار
  // Commercial registration number of the company or establishment
  // that legally owns the property being advertised.
  // Used by: advertiserType = 'owner', 'agent', 'broker'
  //          (only when propertyOwnerIdType = 'commercial_registration')
  // Required: Conditional — only when owner is a company/establishment
  @Column({ type: 'varchar', nullable: true })
  establishmentCommercialRegNumber!: string | null;

  // ── AGENT-SPECIFIC FIELDS ─────────────────────────────────────────────────────
  // الحقول الخاصة بالوكيل (advertiserType = 'agent' ONLY)

  // رقم الوكالة الرسمية (صادرة من وزارة العدل)
  // Official Power of Attorney (POA) document number issued by the
  // Saudi Ministry of Justice (وزارة العدل).
  // Proves that the agent is legally authorized by the property owner
  // to act on their behalf in this real estate transaction.
  // Used by: advertiserType = 'agent' ONLY
  // Required: YES when advertiserType = 'agent'
  @Column({ type: 'varchar', nullable: true })
  powerOfAttorneyNumber!: string | null;

  // رقم الهوية الوطنية للوكيل
  // National ID number of the agent (the person doing the advertising).
  // Used by: advertiserType = 'agent' ONLY
  // Required: YES when advertiserType = 'agent'
  @Column({ type: 'varchar', nullable: true })
  agentNationalIdNumber!: string | null;

  // تاريخ ميلاد الوكيل
  // Date of birth of the agent.
  // Used by: advertiserType = 'agent' ONLY
  // Required: YES when advertiserType = 'agent'
  @Column({ type: 'date', nullable: true })
  agentBirthDate!: string | null;

  // رقم جوال الوكيل
  // Mobile phone number of the agent.
  // Used by: advertiserType = 'agent' ONLY
  // Required: YES when advertiserType = 'agent'
  @Column({ type: 'varchar', nullable: true })
  agentPhone!: string | null;

  // ── LICENSED BROKER-SPECIFIC FIELDS ──────────────────────────────────────────
  // الحقول الخاصة بالمسوق العقاري المرخص (advertiserType = 'broker' ONLY)

  // رقم رخصة فال للوساطة والتسويق العقاري
  // FAL license number issued by the General Real Estate Authority (REGA).
  // Mandatory for all licensed real estate brokers operating in Saudi Arabia.
  // Without a valid FAL license, a broker cannot legally advertise property.
  // Used by: advertiserType = 'broker' ONLY
  // Required: YES when advertiserType = 'broker'
  @Column({ type: 'varchar', nullable: true })
  falLicenseNumber!: string | null;

  // رقم عقد الوساطة المسجل مع مالك العقار
  // Brokerage contract number registered on the REGA platform
  // (eservicesredp.rega.gov.sa) between the broker and the property owner.
  // CRITICAL: Both FAL license AND brokerage contract are required.
  // A valid FAL license alone is not sufficient — the contract proves
  // the broker has a signed agreement with the owner for THIS property.
  // Used by: advertiserType = 'broker' ONLY
  // Required: YES when advertiserType = 'broker'
  @Column({ type: 'varchar', nullable: true })
  brokerageContractNumber!: string | null;
}
