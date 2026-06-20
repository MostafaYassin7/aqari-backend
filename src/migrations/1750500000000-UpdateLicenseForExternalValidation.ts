import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateLicenseForExternalValidation1750500000000
  implements MigrationInterface
{
  name = 'UpdateLicenseForExternalValidation1750500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ── Add isExternallyValidated column ──────────────────────────────────────
    // Flags broker/host records validated via external API (REGA / Ministry of Tourism).
    // These records are temporary and deleted after the listing is published.
    // Owner/agent records (isExternallyValidated = false) are kept for admin review.
    await queryRunner.query(
      `ALTER TABLE "property_advertisement_licenses"
       ADD COLUMN IF NOT EXISTS "isExternallyValidated" boolean NOT NULL DEFAULT false`,
    );

    // ── Remove broker-specific columns ────────────────────────────────────────
    // Broker validation is now handled via REGA API (validate-broker endpoint).
    // These fields are no longer stored on the license record.
    await queryRunner.query(
      `ALTER TABLE "property_advertisement_licenses"
       DROP COLUMN IF EXISTS "falLicenseNumber"`,
    );

    await queryRunner.query(
      `ALTER TABLE "property_advertisement_licenses"
       DROP COLUMN IF EXISTS "brokerageContractNumber"`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Restore broker-specific columns
    await queryRunner.query(
      `ALTER TABLE "property_advertisement_licenses"
       ADD COLUMN IF NOT EXISTS "falLicenseNumber" character varying`,
    );

    await queryRunner.query(
      `ALTER TABLE "property_advertisement_licenses"
       ADD COLUMN IF NOT EXISTS "brokerageContractNumber" character varying`,
    );

    // Remove isExternallyValidated column
    await queryRunner.query(
      `ALTER TABLE "property_advertisement_licenses"
       DROP COLUMN IF EXISTS "isExternallyValidated"`,
    );
  }
}
