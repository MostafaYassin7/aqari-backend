import { UnauthorizedException } from '@nestjs/common';
import { JwtPayload, JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  const usersRepo = { findOne: jest.fn() };
  const strategy = new JwtStrategy({ get: () => 'secret' } as never, usersRepo as never);

  beforeEach(() => usersRepo.findOne.mockReset());

  it('rejects payloads without a sub before touching the database', async () => {
    await expect(strategy.validate({} as JwtPayload)).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate({ sub: '' } as JwtPayload)).rejects.toThrow(UnauthorizedException);
    expect(usersRepo.findOne).not.toHaveBeenCalled();
  });

  it('still loads the user for a valid payload', async () => {
    usersRepo.findOne.mockResolvedValue({ id: 'u-1' });
    await expect(
      strategy.validate({ sub: 'u-1', phone: '+966500000001', role: 'USER' }),
    ).resolves.toEqual({ id: 'u-1' });
  });
});
