import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEventHallToCategoryEnum1788912000000 implements MigrationInterface {
  name = 'AddEventHallToCategoryEnum1788912000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "public"."listing_categories_propertytype_enum"
      ADD VALUE IF NOT EXISTS 'event_hall'
    `);
  }

  async down(): Promise<void> {
    // PostgreSQL cannot remove an enum value safely. Keep event_hall in place.
  }
}
