import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { NafathCallbackDto } from './dto/nafath-callback.dto';
import { NafathIpGuard } from './nafath-ip.guard';
import { normalizeIp } from './nafath-ip.util';
import { NafathService } from './nafath.service';

/**
 * The single callback URL registered with Elm. Two kinds of caller hit it:
 * - Nafath Web: the user's browser returns with a single-use `state`
 *   (form POST or query string) → we finish the login and redirect the
 *   browser to the frontend. Comes from the user's IP, so no IP allow-list.
 * - Nafath app-push (MFA): Elm's servers POST `{ token, transId, requestId }`
 *   → only accepted from Nafath's source IPs.
 */
@ApiExcludeController()
@Controller('nafath')
export class NafathCallbackController {
  constructor(
    private readonly nafath: NafathService,
    private readonly ipGuard: NafathIpGuard,
  ) {}

  @Public()
  @Get('callback')
  async webCallback(
    @Query('state') state: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (typeof state !== 'string' || !state) {
      throw new BadRequestException({
        message: 'Missing Nafath state',
        error: 'NAFATH_INVALID_CALLBACK',
      });
    }
    res.redirect(
      303,
      await this.nafath.completeWebLogin(state, normalizeIp(req.ip)),
    );
  }

  /**
   * Body is typed as a plain object on purpose: the global ValidationPipe
   * (forbidNonWhitelisted) skips non-class types, so extra fields Nafath may
   * add do not cause every callback to be rejected.
   */
  @Public()
  @Post('callback')
  async callback(
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Express 5 leaves req.body undefined for requests without a parsed body.
    const input = typeof body === 'object' && body !== null ? body : {};

    // Web posts `state` (+ status / user data); app-push always carries `transId`.
    if (
      typeof input.state === 'string' &&
      input.state &&
      !('transId' in input)
    ) {
      res.redirect(
        303,
        await this.nafath.completeWebLogin(input.state, normalizeIp(req.ip)),
      );
      return;
    }

    this.ipGuard.assertAllowed(req.ip);
    const dto = plainToInstance(NafathCallbackDto, input);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: false,
    });
    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Invalid Nafath callback body',
        error: 'NAFATH_INVALID_CALLBACK',
      });
    }
    await this.nafath.handleCallback(dto);
    res
      .status(200)
      .json({ success: true, data: { received: true }, message: 'OK' });
  }
}
