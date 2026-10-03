import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { NafathApiError, toHttpError } from './nafath.errors';

describe('toHttpError', () => {
  it('maps an active transaction to 409 NAFATH_REQUEST_PENDING', () => {
    const err = toHttpError(new NafathApiError(400, '400-034-050', 77, 'active'));
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ error: 'NAFATH_REQUEST_PENDING' });
  });

  it('maps invalid data to 400 NAFATH_INVALID_REQUEST', () => {
    const err = toHttpError(new NafathApiError(422, '422-031-046', 1, 'invalid'));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ error: 'NAFATH_INVALID_REQUEST' });
  });

  it('maps auth failures, outages and unknown errors to 503 NAFATH_UNAVAILABLE', () => {
    for (const input of [
      new NafathApiError(403, null, null, 'forbidden'),
      new NafathApiError(0, null, null, 'network'),
      new Error('boom'),
    ]) {
      const err = toHttpError(input);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(err.getResponse()).toMatchObject({ error: 'NAFATH_UNAVAILABLE' });
    }
  });
});
