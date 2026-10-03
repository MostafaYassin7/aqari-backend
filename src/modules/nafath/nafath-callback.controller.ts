import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { NafathCallbackDto } from './dto/nafath-callback.dto';
import { NafathIpGuard } from './nafath-ip.guard';
import { NafathService } from './nafath.service';

@ApiExcludeController()
@Controller('nafath')
export class NafathCallbackController {
  constructor(private readonly nafath: NafathService) {}

  /**
   * Body is typed as a plain object on purpose: the global ValidationPipe
   * (forbidNonWhitelisted) skips non-class types, so extra fields Nafath may
   * add do not cause every callback to be rejected.
   */
  @Public()
  @UseGuards(NafathIpGuard)
  @Post('callback')
  @HttpCode(200)
  async callback(
    @Body() body: Record<string, unknown>,
  ): Promise<{ received: true }> {
    const dto = plainToInstance(NafathCallbackDto, body);
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
    return { received: true };
  }
}
