import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { NafathCallbackController } from './nafath-callback.controller';
import { NafathConfig } from './nafath.config';
import { NafathIpGuard } from './nafath-ip.guard';

describe('NafathCallbackController', () => {
  const valid = {
    token: 'jwt',
    transId: 't-1',
    requestId: '2b1f8c1e-7d1a-4c5e-9a39-0f1c2d3e4f50',
  };
  const nafathIp = { ip: '195.170.180.7' } as never;
  const browserIp = { ip: '5.5.5.5' } as never;

  function make() {
    const service = {
      handleCallback: jest.fn().mockResolvedValue(undefined),
      completeWebLogin: jest
        .fn()
        .mockResolvedValue('https://aqora.sa/ar/nafath/callback#token=abc'),
    };
    const guard = new NafathIpGuard({
      callbackAllowedIps: ['195.170.180.7', '195.170.180.6'],
    } as NafathConfig);
    const res = {
      redirect: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    return {
      controller: new NafathCallbackController(service as never, guard),
      service,
      res,
    };
  }

  describe('app-push (MFA) callbacks', () => {
    it('accepts bodies with extra fields Nafath may add', async () => {
      const { controller, service, res } = make();
      await controller.callback(
        { ...valid, status: 'COMPLETED', extra: 1 },
        nafathIp,
        res as never,
      );
      expect(service.handleCallback).toHaveBeenCalledWith(
        expect.objectContaining(valid),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('rejects bodies missing fields, a non-UUID requestId, or no body', async () => {
      const { controller, service, res } = make();
      await expect(
        controller.callback(
          { transId: 't-1', requestId: valid.requestId },
          nafathIp,
          res as never,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.callback(
          { ...valid, requestId: 'not-a-uuid' },
          nafathIp,
          res as never,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.callback(undefined as never, nafathIp, res as never),
      ).rejects.toThrow(BadRequestException);
      expect(service.handleCallback).not.toHaveBeenCalled();
    });

    it('rejects app-push payloads from non-Nafath IPs', async () => {
      const { controller, service, res } = make();
      await expect(
        controller.callback(valid, browserIp, res as never),
      ).rejects.toThrow(ForbiddenException);
      expect(service.handleCallback).not.toHaveBeenCalled();
    });
  });

  describe('Nafath Web (browser) callbacks', () => {
    it('finishes a form-POSTed state from any IP and redirects the browser', async () => {
      const { controller, service, res } = make();
      await controller.callback({ state: 's-1' }, browserIp, res as never);
      expect(service.completeWebLogin).toHaveBeenCalledWith('s-1', '5.5.5.5');
      expect(res.redirect).toHaveBeenCalledWith(
        303,
        'https://aqora.sa/ar/nafath/callback#token=abc',
      );
      expect(service.handleCallback).not.toHaveBeenCalled();
    });

    it('finishes a state passed in the query string', async () => {
      const { controller, service, res } = make();
      await controller.webCallback('s-2', browserIp, res as never);
      expect(service.completeWebLogin).toHaveBeenCalledWith('s-2', '5.5.5.5');
      expect(res.redirect).toHaveBeenCalledWith(303, expect.any(String));
    });

    it('rejects a GET without state', async () => {
      const { controller, service, res } = make();
      await expect(
        controller.webCallback(undefined, browserIp, res as never),
      ).rejects.toThrow(BadRequestException);
      expect(service.completeWebLogin).not.toHaveBeenCalled();
    });
  });
});
