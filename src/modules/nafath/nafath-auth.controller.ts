import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { User } from '../users/entities/user.entity';
import { LinkNafathDto } from './dto/link-nafath.dto';
import { StartNafathDto } from './dto/start-nafath.dto';
import { normalizeIp } from './nafath-ip.util';
import { NafathService } from './nafath.service';

@ApiTags('Auth — Nafath')
@Controller('auth/nafath')
export class NafathAuthController {
  constructor(private readonly nafath: NafathService) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('start')
  @ApiOperation({
    summary:
      'Start a Nafath login — returns requestId and the number to show the user',
  })
  @ApiResponse({ status: 201, description: '{ requestId, random, expiresAt }' })
  start(@Body() dto: StartNafathDto, @Req() req: Request) {
    return this.nafath.start(dto.nationalId, dto.lang, normalizeIp(req.ip));
  }

  @Public()
  @Get('status/:requestId')
  @ApiOperation({
    summary:
      'Poll a Nafath login — returns a token or linkToken once COMPLETED',
  })
  status(
    @Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string,
  ) {
    return this.nafath.getStatus(requestId);
  }

  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @Post('link')
  @ApiOperation({
    summary:
      'Link a Nafath-verified national ID to the logged-in (OTP) account',
  })
  link(@GetUser() user: User, @Body() dto: LinkNafathDto) {
    return this.nafath.link(user.id, dto.linkToken);
  }
}
