import {
  TransactionReferenceType,
  TransactionType,
} from './entities/transaction.entity';
import { WalletService } from './wallet.service';

describe('WalletService transaction filters', () => {
  it('filters transaction direction independently from reference type', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const service = new WalletService(
      { findOne: jest.fn().mockResolvedValue({ id: 'wallet-1' }) } as never,
      { createQueryBuilder: jest.fn().mockReturnValue(qb) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.getTransactions(
      'user-1',
      TransactionReferenceType.BOOKING,
      TransactionType.CREDIT,
      2,
      10,
    );

    expect(qb.andWhere).toHaveBeenCalledWith(
      't.referenceType = :referenceType',
      { referenceType: TransactionReferenceType.BOOKING },
    );
    expect(qb.andWhere).toHaveBeenCalledWith('t.type = :type', {
      type: TransactionType.CREDIT,
    });
    expect(qb.skip).toHaveBeenCalledWith(10);
    expect(qb.take).toHaveBeenCalledWith(10);
  });
});
