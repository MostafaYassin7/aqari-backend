import { IsNull, LessThan } from 'typeorm';
import { NafathRequestStatus } from './entities/nafath-request.entity';
import { NafathConfig } from './nafath.config';
import { NafathCron } from './nafath.cron';

describe('NafathCron', () => {
  const repo = {
    update: jest.fn().mockResolvedValue({ affected: 2 }),
    delete: jest.fn().mockResolvedValue({ affected: 3 }),
  };
  const cron = new NafathCron(
    repo as never,
    { graceSeconds: 20, retentionDays: 30 } as NafathConfig,
  );

  beforeEach(() => jest.clearAllMocks());

  it('expires WAITING rows past expiry + grace', async () => {
    const before = Date.now();
    await cron.expireStale();

    const [where, set] = repo.update.mock.calls[0] as [
      { status: string; expiresAt: ReturnType<typeof LessThan> },
      { status: string; completedAt: Date },
    ];
    expect(where.status).toBe(NafathRequestStatus.WAITING);
    const cutoff = (
      where.expiresAt as unknown as { value: Date }
    ).value.getTime();
    expect(before - cutoff).toBeGreaterThanOrEqual(20_000);
    expect(before - cutoff).toBeLessThan(21_000);
    expect(set).toEqual({
      status: NafathRequestStatus.EXPIRED,
      completedAt: expect.any(Date),
    } as Record<string, unknown>);
  });

  it('expires unconsumed COMPLETED results past the redeem window', async () => {
    const before = Date.now();
    await cron.expireStale();

    expect(repo.update).toHaveBeenCalledTimes(2);
    const [where, set] = repo.update.mock.calls[1] as [
      {
        status: string;
        consumedAt: unknown;
        completedAt: ReturnType<typeof LessThan>;
      },
      { status: string },
    ];
    expect(where.status).toBe(NafathRequestStatus.COMPLETED);
    expect(where.consumedAt).toEqual(IsNull());
    const cutoff = (
      where.completedAt as unknown as { value: Date }
    ).value.getTime();
    expect(before - cutoff).toBeGreaterThanOrEqual(5 * 60 * 1000);
    expect(before - cutoff).toBeLessThan(5 * 60 * 1000 + 1_000);
    expect(set).toEqual({ status: NafathRequestStatus.EXPIRED });
  });

  it('deletes rows older than the retention period', async () => {
    const before = Date.now();
    await cron.purgeOld();

    const [where] = repo.delete.mock.calls[0] as [
      { createdAt: ReturnType<typeof LessThan> },
    ];
    const cutoff = (
      where.createdAt as unknown as { value: Date }
    ).value.getTime();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(before - cutoff).toBeGreaterThanOrEqual(thirtyDays);
    expect(before - cutoff).toBeLessThan(thirtyDays + 1_000);
  });
});
