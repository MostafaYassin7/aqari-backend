import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

export const NAFATH_CODES = {
  ACTIVE_TRX: '400-034-050',
  TRX_EXPIRED: '400-034-051',
  TRX_NOT_FOUND: '400-034-053',
  INVALID_REQUEST: '422-031-046',
} as const;

/** Error returned by (or while calling) Elm's Nafath API. httpStatus 0 = network/timeout. */
export class NafathApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string | null,
    readonly reference: string | number | null,
    message: string,
  ) {
    super(message);
    this.name = 'NafathApiError';
  }
}

/** A callback JWT failed verification (signature, kid, alg, aud, expiry). */
export class NafathTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NafathTokenError';
  }
}

export const nafathError = {
  disabled: () =>
    new ServiceUnavailableException({
      message: 'Nafath login is not enabled',
      error: 'NAFATH_DISABLED',
    }),
  unavailable: () =>
    new ServiceUnavailableException({
      message: 'Nafath is unavailable, try again later',
      error: 'NAFATH_UNAVAILABLE',
    }),
  pending: () =>
    new ConflictException({
      message:
        'A Nafath request is already open for this ID — approve it or try again in about a minute',
      error: 'NAFATH_REQUEST_PENDING',
    }),
  invalidRequest: () =>
    new BadRequestException({
      message: 'Nafath rejected the request data',
      error: 'NAFATH_INVALID_REQUEST',
    }),
  rateLimited: () =>
    new HttpException(
      {
        message: 'Too many Nafath requests for this ID, try again later',
        error: 'NAFATH_RATE_LIMITED',
      },
      429,
    ),
  notFound: () =>
    new NotFoundException({
      message: 'Nafath request not found',
      error: 'NAFATH_REQUEST_NOT_FOUND',
    }),
  alreadyUsed: () =>
    new GoneException({
      message: 'This Nafath result was already used — start again',
      error: 'NAFATH_RESULT_ALREADY_USED',
    }),
  accountInactive: () =>
    new ForbiddenException({
      message: 'This account is inactive',
      error: 'NAFATH_ACCOUNT_INACTIVE',
    }),
  invalidToken: () =>
    new BadRequestException({
      message: 'Invalid Nafath callback',
      error: 'NAFATH_INVALID_CALLBACK',
    }),
  linkTokenInvalid: () =>
    new UnauthorizedException({
      message: 'Nafath link token is invalid or expired',
      error: 'NAFATH_LINK_TOKEN_INVALID',
    }),
  linkInvalid: () =>
    new ConflictException({
      message: 'This Nafath result cannot be linked',
      error: 'NAFATH_LINK_INVALID',
    }),
  idLinkedToOther: () =>
    new ConflictException({
      message: 'This national ID is already linked to another account',
      error: 'NAFATH_ID_LINKED_TO_OTHER_ACCOUNT',
    }),
  accountHasOtherId: () =>
    new ConflictException({
      message: 'This account is already linked to a different national ID',
      error: 'NAFATH_ACCOUNT_HAS_OTHER_ID',
    }),
};

export function toHttpError(err: unknown): HttpException {
  if (err instanceof NafathApiError) {
    if (err.code === NAFATH_CODES.ACTIVE_TRX) return nafathError.pending();
    if (err.code === NAFATH_CODES.INVALID_REQUEST || err.httpStatus === 422) {
      return nafathError.invalidRequest();
    }
  }
  return nafathError.unavailable();
}
