import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePayments1750600000000 implements MigrationInterface {
  name = 'CreatePayments1750600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."payments_type_enum" AS ENUM ('top_up', 'reservation', 'promotion')
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."payments_paymentstatus_enum" AS ENUM ('pending', 'paid', 'failed', 'refunded')
    `);

    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id"                  uuid                NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt"           TIMESTAMP           NOT NULL DEFAULT now(),
        "updatedAt"           TIMESTAMP           NOT NULL DEFAULT now(),
        "deletedAt"           TIMESTAMP,
        "userId"              uuid                NOT NULL,
        "type"                "public"."payments_type_enum" NOT NULL,
        "referenceId"         uuid,
        "invoiceId"           character varying,
        "invoiceValue"        numeric(12,2)       NOT NULL,
        "displayCurrencyIso"  character varying   NOT NULL DEFAULT 'SAR',
        "paymentStatus"       "public"."payments_paymentstatus_enum" NOT NULL DEFAULT 'pending',
        "paymentURL"          character varying,
        "paymentMethod"       character varying,
        "errorMessage"        character varying,
        CONSTRAINT "PK_payments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payments_userId" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_payments_userId"        ON "payments" ("userId")`);
    await queryRunner.query(`CREATE INDEX "IDX_payments_paymentStatus" ON "payments" ("paymentStatus")`);
    await queryRunner.query(`CREATE INDEX "IDX_payments_invoiceId"     ON "payments" ("invoiceId")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payments_invoiceId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payments_paymentStatus"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payments_userId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payments"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."payments_paymentstatus_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."payments_type_enum"`);
  }
}
