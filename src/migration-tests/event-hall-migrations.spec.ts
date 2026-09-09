/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { QueryRunner } from 'typeorm';
import { AddEventHallToCategoryEnum1788912000000 } from '../migrations/1788912000000-AddEventHallToCategoryEnum';
import { UpsertEventHallCategory1788912001000 } from '../migrations/1788912001000-UpsertEventHallCategory';

describe('event hall category migrations', () => {
  it('adds the enum idempotently and upserts/reactivates the category', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const runner = { query } as unknown as QueryRunner;

    await new AddEventHallToCategoryEnum1788912000000().up(runner);
    await new UpsertEventHallCategory1788912001000().up(runner);

    expect(query.mock.calls[0][0]).toContain(
      "ADD VALUE IF NOT EXISTS 'event_hall'",
    );
    expect(query.mock.calls[1][0]).toContain('"isActive" = true');
    expect(query.mock.calls[2][0]).toContain('WHERE NOT EXISTS');
    expect(query.mock.calls[2][0]).toContain("'rent_short'");
  });

  it('deactivates the category without attempting to remove the enum', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const runner = { query } as unknown as QueryRunner;

    await new UpsertEventHallCategory1788912001000().down(runner);
    await new AddEventHallToCategoryEnum1788912000000().down();

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('"isActive" = false');
  });
});
