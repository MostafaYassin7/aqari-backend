import { ExecutionContext, HttpException } from '@nestjs/common';
import { NafathThrottlerGuard } from './nafath-throttler.guard';

describe('NafathThrottlerGuard', () => {
  it('throws 429 with the NAFATH_RATE_LIMITED error code', async () => {
    const guard = new NafathThrottlerGuard(
      { throttlers: [{ limit: 5, ttl: 60_000 }] } as never,
      {} as never,
      {} as never,
    );
    const throwThrottlingException = (
      guard as unknown as {
        throwThrottlingException: (
          ctx: ExecutionContext,
          detail: unknown,
        ) => Promise<void>;
      }
    ).throwThrottlingException.bind(guard);

    let caught: unknown;
    try {
      await throwThrottlingException({} as ExecutionContext, {});
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(HttpException);
    const exception = caught as HttpException;
    expect(exception.getStatus()).toBe(429);
    expect(exception.getResponse()).toMatchObject({
      error: 'NAFATH_RATE_LIMITED',
    });
  });
});
