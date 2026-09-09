import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpsertEventHallCategory1788912001000 implements MigrationInterface {
  name = 'UpsertEventHallCategory1788912001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "listing_categories"
      SET
        "name" = 'Event Hall',
        "nameAr" = 'قاعة مناسبات واحتفالات',
        "propertyType" = 'event_hall',
        "listingType" = 'rent_short',
        "isActive" = true,
        "updatedAt" = now()
      WHERE "name" = 'Event Hall'
         OR "propertyType"::text = 'event_hall'
    `);

    await queryRunner.query(`
      INSERT INTO "listing_categories" (
        "name", "nameAr", "propertyType", "listingType", "sortOrder", "isActive"
      )
      SELECT
        'Event Hall',
        'قاعة مناسبات واحتفالات',
        'event_hall',
        'rent_short',
        COALESCE((SELECT MAX("sortOrder") FROM "listing_categories"), 0) + 1,
        true
      WHERE NOT EXISTS (
        SELECT 1
        FROM "listing_categories"
        WHERE "name" = 'Event Hall'
           OR "propertyType"::text = 'event_hall'
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "listing_categories"
      SET "isActive" = false, "updatedAt" = now()
      WHERE "name" = 'Event Hall'
         OR "propertyType"::text = 'event_hall'
    `);
  }
}
