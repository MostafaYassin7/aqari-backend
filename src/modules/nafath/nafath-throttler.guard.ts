import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { nafathError } from './nafath.errors';

/** ThrottlerGuard whose 429 carries the NAFATH_RATE_LIMITED error code the clients switch on. */
@Injectable()
export class NafathThrottlerGuard extends ThrottlerGuard {
  protected throwThrottlingException(
    _context: ExecutionContext,
    _throttlerLimitDetail: unknown,
  ): Promise<void> {
    return Promise.reject(nafathError.rateLimited());
  }
}
