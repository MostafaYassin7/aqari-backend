import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBookingTables1751100000000 implements MigrationInterface {
  name = 'CreateBookingTables1751100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "listing_availability" (
        "id"           uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt"    TIMESTAMP         NOT NULL DEFAULT now(),
        "updatedAt"    TIMESTAMP         NOT NULL DEFAULT now(),
        "deletedAt"    TIMESTAMP,
        "listingId"    uuid              NOT NULL,
        "date"         date              NOT NULL,
        "timeSlot"     character varying,
        "blockReason"  character varying NOT NULL DEFAULT 'booked',
        "bookingId"    uuid,
        CONSTRAINT "PK_listing_availability" PRIMARY KEY ("id"),
        CONSTRAINT "FK_listing_availability_listingId" FOREIGN KEY ("listingId")
          REFERENCES "listings"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_listing_availability_listingId" ON "listing_availability" ("listingId")`);
    await queryRunner.query(`CREATE INDEX "IDX_listing_availability_date"      ON "listing_availability" ("date")`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_listing_availability_daily" ON "listing_availability" ("listingId", "date")
        WHERE "timeSlot" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_listing_availability_hall" ON "listing_availability" ("listingId", "date", "timeSlot")
        WHERE "timeSlot" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "bookings" (
        "id"             uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt"      TIMESTAMP         NOT NULL DEFAULT now(),
        "updatedAt"      TIMESTAMP         NOT NULL DEFAULT now(),
        "deletedAt"      TIMESTAMP,
        "listingId"      uuid              NOT NULL,
        "guestId"        uuid              NOT NULL,
        "ownerId"        uuid              NOT NULL,
        "checkInDate"    date,
        "checkOutDate"   date,
        "nights"         integer,
        "eventDate"      date,
        "timeSlot"       character varying,
        "guestCount"     integer,
        "totalPrice"     numeric(10,2)     NOT NULL,
        "status"         character varying NOT NULL DEFAULT 'pending',
        "notes"          text,
        CONSTRAINT "PK_bookings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_bookings_listingId" FOREIGN KEY ("listingId")
          REFERENCES "listings"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_bookings_listingId" ON "bookings" ("listingId")`);
    await queryRunner.query(`CREATE INDEX "IDX_bookings_guestId"   ON "bookings" ("guestId")`);
    await queryRunner.query(`CREATE INDEX "IDX_bookings_ownerId"   ON "bookings" ("ownerId")`);
    await queryRunner.query(`CREATE INDEX "IDX_bookings_status"    ON "bookings" ("status")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "bookings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "listing_availability"`);
  }
}
