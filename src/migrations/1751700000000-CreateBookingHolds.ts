import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBookingHolds1751700000000 implements MigrationInterface {
  name = 'CreateBookingHolds1751700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."booking_holds_status_enum" AS ENUM ('held', 'released', 'refunded', 'disputed')
    `);

    await queryRunner.query(`
      CREATE TABLE "booking_holds" (
        "id"             uuid               NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt"      TIMESTAMP          NOT NULL DEFAULT now(),
        "updatedAt"      TIMESTAMP          NOT NULL DEFAULT now(),
        "deletedAt"      TIMESTAMP,
        "bookingId"      uuid               NOT NULL,
        "guestWalletId"  uuid               NOT NULL,
        "hostWalletId"   uuid               NOT NULL,
        "amount"         numeric(12,2)      NOT NULL,
        "currency"       character varying  NOT NULL DEFAULT 'SAR',
        "status"         "public"."booking_holds_status_enum" NOT NULL DEFAULT 'held',
        "releaseAt"      TIMESTAMP          NOT NULL,
        "releasedAt"     TIMESTAMP,
        "refundedAt"     TIMESTAMP,
        "disputedAt"     TIMESTAMP,
        CONSTRAINT "PK_booking_holds" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_booking_holds_bookingId" UNIQUE ("bookingId"),
        CONSTRAINT "FK_booking_holds_bookingId" FOREIGN KEY ("bookingId")
          REFERENCES "bookings"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_booking_holds_guestWalletId" FOREIGN KEY ("guestWalletId")
          REFERENCES "wallets"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_booking_holds_hostWalletId" FOREIGN KEY ("hostWalletId")
          REFERENCES "wallets"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_booking_holds_bookingId"     ON "booking_holds" ("bookingId")`);
    await queryRunner.query(`CREATE INDEX "IDX_booking_holds_guestWalletId" ON "booking_holds" ("guestWalletId")`);
    await queryRunner.query(`CREATE INDEX "IDX_booking_holds_hostWalletId"  ON "booking_holds" ("hostWalletId")`);
    await queryRunner.query(`CREATE INDEX "IDX_booking_holds_status"        ON "booking_holds" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_booking_holds_releaseAt"     ON "booking_holds" ("releaseAt")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_booking_holds_releaseAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_booking_holds_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_booking_holds_hostWalletId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_booking_holds_guestWalletId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_booking_holds_bookingId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "booking_holds"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."booking_holds_status_enum"`);
  }
}
