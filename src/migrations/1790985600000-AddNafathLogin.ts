import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNafathLogin1790985600000 implements MigrationInterface {
  name = 'AddNafathLogin1790985600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "nationalId" character varying(10)`);
    await queryRunner.query(`ALTER TABLE "users" ADD "nafathVerifiedAt" TIMESTAMP`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_users_nationalId" UNIQUE ("nationalId")`,
    );

    await queryRunner.query(`
      CREATE TABLE "nafath_requests" (
        "id"           uuid              NOT NULL,
        "nationalId"   character varying(10) NOT NULL,
        "transId"      character varying,
        "random"       character varying,
        "service"      character varying NOT NULL,
        "status"       character varying NOT NULL DEFAULT 'WAITING',
        "statusSource" character varying,
        "claims"       jsonb,
        "clientIp"     character varying NOT NULL,
        "expiresAt"    TIMESTAMP         NOT NULL,
        "lastPolledAt" TIMESTAMP,
        "completedAt"  TIMESTAMP,
        "consumedAt"   TIMESTAMP,
        "linkedUserId" uuid,
        "createdAt"    TIMESTAMP         NOT NULL DEFAULT now(),
        "updatedAt"    TIMESTAMP         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_nafath_requests" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_nafath_requests_transId" UNIQUE ("transId"),
        CONSTRAINT "FK_nafath_requests_linkedUserId"
          FOREIGN KEY ("linkedUserId") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_nafath_requests_status"
          CHECK ("status" IN ('WAITING', 'COMPLETED', 'REJECTED', 'EXPIRED', 'FAILED')),
        CONSTRAINT "CHK_nafath_requests_statusSource"
          CHECK ("statusSource" IS NULL OR "statusSource" IN ('callback', 'poll'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_nafath_requests_nationalId_createdAt" ON "nafath_requests" ("nationalId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_nafath_requests_status_expiresAt" ON "nafath_requests" ("status", "expiresAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_nafath_requests_createdAt" ON "nafath_requests" ("createdAt")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "nafath_requests"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "UQ_users_nationalId"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "nafathVerifiedAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "nationalId"`);
  }
}
