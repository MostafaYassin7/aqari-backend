import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateOwnerIdFields1750410000000 implements MigrationInterface {
  name = 'UpdateOwnerIdFields1750410000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ── Add three separate owner-ID columns ───────────────────────────────────
    // Replaces the single propertyOwnerIdNumber and establishmentCommercialRegNumber
    // columns with three mutually-exclusive fields, one per propertyOwnerIdType value.
    // Only one of the three will ever be non-null for a given license record.

    await queryRunner.query(
      `ALTER TABLE "property_advertisement_licenses"
       ADD COLUMN IF NOT EXISTS "ownerNationalIdNumber" character varying`,
    );

    await queryRunner.query(
      `ALTER TABLE "property_advertisement_licenses"
       ADD COLUMN IF NOT EXISTS "ownerCommercialRegNumber" character varying`,
    );

    await queryRunner.query(
      `ALTER TABLE "property_advertisement_licenses"
       ADD COLUMN IF NOT EXISTS "ownerUnifiedNumber" character varying`,
    );

    // ── Drop the old unified columns ──────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "property_advertisement_licenses"
       DROP COLUMN IF EXISTS "propertyOwnerIdNumber"`,
    );

    await queryRunner.query(
      `ALTER TABLE "property_advertisement_licenses"
       DROP COLUMN IF EXISTS "establishmentCommercialRegNumber"`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Restore old columns
    await queryRunner.query(
      `ALTER TABLE "property_advertisement_licenses"
       ADD COLUMN IF NOT EXISTS "propertyOwnerIdNumber" character varying`,
    );

    await queryRunner.query(
      `ALTER TABLE "property_advertisement_licenses"
       ADD COLUMN IF NOT EXISTS "establishmentCommercialRegNumber" character varying`,
    );

    // Drop new columns
    await queryRunner.query(
      `ALTER TABLE "property_advertisement_licenses"
       DROP COLUMN IF EXISTS "ownerNationalIdNumber"`,
    );

    await queryRunner.query(
      `ALTER TABLE "property_advertisement_licenses"
       DROP COLUMN IF EXISTS "ownerCommercialRegNumber"`,
    );

    await queryRunner.query(
      `ALTER TABLE "property_advertisement_licenses"
       DROP COLUMN IF EXISTS "ownerUnifiedNumber"`,
    );
  }
}
