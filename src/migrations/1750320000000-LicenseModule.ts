import { MigrationInterface, QueryRunner } from 'typeorm';

export class LicenseModule1750320000000 implements MigrationInterface {
  name = 'LicenseModule1750320000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Add 'draft' to the listings status enum ────────────────────────────
    // PostgreSQL requires ALTER TYPE to add a new enum value.
    // IF NOT EXISTS prevents failure if migration is re-run.
    await queryRunner.query(
      `ALTER TYPE "listings_status_enum" ADD VALUE IF NOT EXISTS 'draft'`,
    );

    // ── 2. Add licenseId column to listings ───────────────────────────────────
    // Nullable UUID — links a listing to its PropertyAdvertisementLicense record.
    // NULL for host listings (no license required).
    // No FK constraint by design — just a plain UUID reference.
    await queryRunner.query(
      `ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "licenseId" uuid`,
    );

    // ── 3. Create property_advertisement_licenses table ───────────────────────
    // Stores the legal identity and authorization documents required by the
    // General Real Estate Authority of Saudi Arabia (الهيئة العامة للعقار)
    // before a real estate listing can be published on Aqar.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "property_advertisement_licenses" (
        "id"                              uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt"                       TIMESTAMP   NOT NULL DEFAULT now(),
        "updatedAt"                       TIMESTAMP   NOT NULL DEFAULT now(),
        "deletedAt"                       TIMESTAMP,

        -- معرّف المستخدم صاحب الطلب
        "advertiserUserId"                uuid        NOT NULL,

        -- معرّف الإعلان المرتبط — NULL حتى يُنشئ المستخدم الإعلان
        "listingId"                       uuid,

        -- نوع المُعلن: 'owner' | 'agent' | 'broker' | 'host'
        "advertiserType"                  varchar     NOT NULL,

        -- حالة المراجعة: 'pending' | 'approved' | 'rejected'
        "reviewStatus"                    varchar     NOT NULL DEFAULT 'pending',

        -- سبب الرفض — يكتبه الأدمن عند الرفض
        "rejectionReason"                 text,

        -- تاريخ ووقت المراجعة
        "reviewedAt"                      TIMESTAMP,

        -- الأدمن المسؤول عن المراجعة
        "reviewedByAdminId"               uuid,

        -- نوع وثيقة ملكية العقار — owner + agent
        "ownershipDocumentType"           varchar,

        -- رقم وثيقة الملكية
        "ownershipDocumentNumber"         varchar,

        -- نوع هوية مالك العقار — owner + agent + broker
        "propertyOwnerIdType"             varchar,

        -- رقم هوية المالك
        "propertyOwnerIdNumber"           varchar,

        -- تاريخ ميلاد المالك
        "propertyOwnerBirthDate"          date,

        -- هل التاريخ هجري؟ (default: true)
        "isHijriCalendar"                 boolean     NOT NULL DEFAULT true,

        -- رقم جوال المالك
        "propertyOwnerPhone"              varchar,

        -- رقم هوية أحد الملاك (عند وجود ملاك متعددين)
        "oneOfOwnersNationalId"           varchar,

        -- رقم السجل التجاري للمنشأة المالكة
        "establishmentCommercialRegNumber" varchar,

        -- رقم الوكالة الرسمية — وكيل فقط
        "powerOfAttorneyNumber"           varchar,

        -- رقم الهوية الوطنية للوكيل
        "agentNationalIdNumber"           varchar,

        -- تاريخ ميلاد الوكيل
        "agentBirthDate"                  date,

        -- رقم جوال الوكيل
        "agentPhone"                      varchar,

        -- رقم رخصة فال — مسوق عقاري فقط
        "falLicenseNumber"                varchar,

        -- رقم عقد الوساطة المسجل على منصة الهيئة العامة للعقار
        "brokerageContractNumber"         varchar,

        CONSTRAINT "PK_property_advertisement_licenses" PRIMARY KEY ("id")
      )
    `);

    // Indexes for common query patterns
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_pal_advertiserUserId"
       ON "property_advertisement_licenses" ("advertiserUserId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_pal_reviewStatus"
       ON "property_advertisement_licenses" ("reviewStatus")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_pal_listingId"
       ON "property_advertisement_licenses" ("listingId")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // ── 3. Drop property_advertisement_licenses ───────────────────────────────
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_pal_listingId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_pal_reviewStatus"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_pal_advertiserUserId"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "property_advertisement_licenses"`,
    );

    // ── 2. Drop licenseId column from listings ────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "listings" DROP COLUMN IF EXISTS "licenseId"`,
    );

    // ── 1. Remove 'draft' from listings_status_enum ───────────────────────────
    // PostgreSQL does not support DROP VALUE on an enum.
    // We recreate the type without 'draft', migrating any draft rows to 'pending'.
    await queryRunner.query(
      `UPDATE "listings" SET "status" = 'pending' WHERE "status" = 'draft'`,
    );
    await queryRunner.query(
      `ALTER TYPE "listings_status_enum" RENAME TO "listings_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "listings_status_enum" AS ENUM ('published', 'paused_temp', 'paused', 'expired', 'pending')`,
    );
    await queryRunner.query(`
      ALTER TABLE "listings"
        ALTER COLUMN "status" TYPE "listings_status_enum"
        USING "status"::text::"listings_status_enum"
    `);
    await queryRunner.query(`DROP TYPE "listings_status_enum_old"`);
  }
}
