import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBookableFieldsToListings1751000000000 implements MigrationInterface {
  name = 'AddBookableFieldsToListings1751000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "public"."listings_propertytype_enum" ADD VALUE IF NOT EXISTS 'event_hall'
    `);

    await queryRunner.query(`
      ALTER TABLE "listings"
        ADD COLUMN "maxGuests"         integer,
        ADD COLUMN "checkInTime"       character varying(5),
        ADD COLUMN "checkOutTime"      character varying(5),
        ADD COLUMN "minNights"         integer DEFAULT 1,
        ADD COLUMN "pricePerHalfDay"   numeric(10,2),
        ADD COLUMN "includedServices"  jsonb
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "listings"
        DROP COLUMN "includedServices",
        DROP COLUMN "pricePerHalfDay",
        DROP COLUMN "minNights",
        DROP COLUMN "checkOutTime",
        DROP COLUMN "checkInTime",
        DROP COLUMN "maxGuests"
    `);

    // Postgres has no DROP VALUE for enums; leaving 'event_hall' in the type on rollback.
  }
}
