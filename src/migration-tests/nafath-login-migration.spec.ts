/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';
import { AddNafathLogin1790985600000 } from '../migrations/1790985600000-AddNafathLogin';
import { User } from '../modules/users/entities/user.entity';

describe('AddNafathLogin migration', () => {
  it('adds user columns and creates nafath_requests with constraints', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddNafathLogin1790985600000().up({ query } as unknown as QueryRunner);

    const sql = query.mock.calls.map((c) => c[0] as string).join('\n');
    expect(sql).toContain('ADD "nationalId" character varying(10)');
    expect(sql).toContain('ADD "nafathVerifiedAt" TIMESTAMP');
    expect(sql).toContain('"UQ_users_nationalId" UNIQUE ("nationalId")');
    expect(sql).toContain('CREATE TABLE "nafath_requests"');
    expect(sql).toContain('"UQ_nafath_requests_transId" UNIQUE ("transId")');
    expect(sql).toContain('REFERENCES "users"("id") ON DELETE SET NULL');
    expect(sql).toContain("'WAITING', 'COMPLETED', 'REJECTED', 'EXPIRED', 'FAILED'");
  });

  it('reverts everything', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddNafathLogin1790985600000().down({ query } as unknown as QueryRunner);

    const sql = query.mock.calls.map((c) => c[0] as string).join('\n');
    expect(sql).toContain('DROP TABLE IF EXISTS "nafath_requests"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "nationalId"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "nafathVerifiedAt"');
  });

  it('hides users.nationalId from default selects', () => {
    const column = getMetadataArgsStorage().columns.find(
      (c) => c.target === User && c.propertyName === 'nationalId',
    );
    expect(column?.options.select).toBe(false);
  });
});
