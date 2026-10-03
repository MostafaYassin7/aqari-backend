import { BadRequestException } from '@nestjs/common';
import { NafathCallbackController } from './nafath-callback.controller';

describe('NafathCallbackController', () => {
  const valid = {
    token: 'jwt',
    transId: 't-1',
    requestId: '2b1f8c1e-7d1a-4c5e-9a39-0f1c2d3e4f50',
  };

  function make() {
    const service = { handleCallback: jest.fn().mockResolvedValue(undefined) };
    return {
      controller: new NafathCallbackController(service as never),
      service,
    };
  }

  it('answers 400 (not 500) when the body is not an object', async () => {
    const { controller, service } = make();
    await expect(controller.callback(undefined as never)).rejects.toThrow(
      BadRequestException,
    );
    expect(service.handleCallback).not.toHaveBeenCalled();
  });

  it('accepts bodies with extra fields Nafath may add', async () => {
    const { controller, service } = make();
    await expect(
      controller.callback({ ...valid, status: 'COMPLETED', extra: 1 }),
    ).resolves.toEqual({
      received: true,
    });
    expect(service.handleCallback).toHaveBeenCalledWith(
      expect.objectContaining(valid),
    );
  });

  it('rejects bodies missing required fields or with a non-UUID requestId', async () => {
    const { controller, service } = make();
    await expect(
      controller.callback({ transId: 't-1', requestId: valid.requestId }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      controller.callback({ ...valid, requestId: 'not-a-uuid' }),
    ).rejects.toThrow(BadRequestException);
    expect(service.handleCallback).not.toHaveBeenCalled();
  });
});
