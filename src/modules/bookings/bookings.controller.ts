import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { User } from '../users/entities/user.entity';
import { BookingsService } from './bookings.service';
import { CheckAvailabilityDto } from './dto/check-availability.dto';
import { CreateBookingDto } from './dto/create-booking.dto';

@ApiTags('Bookings')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @UseGuards(JwtGuard)
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a booking request' })
  @ApiResponse({ status: 201, description: 'Booking created' })
  create(@GetUser() user: User, @Body() dto: CreateBookingDto) {
    return this.bookingsService.createBooking(user.id, dto);
  }

  @Public()
  @Post('check-availability/:listingId')
  @ApiOperation({ summary: 'Check listing availability for given dates/slot' })
  checkAvailability(
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: CheckAvailabilityDto,
  ) {
    return this.bookingsService.checkAvailability(listingId, dto);
  }

  @UseGuards(JwtGuard)
  @Get('my/guest')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get current user's bookings as guest" })
  getMyBookingsAsGuest(
    @GetUser() user: User,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.bookingsService.getMyBookingsAsGuest(user.id, page, limit);
  }

  @UseGuards(JwtGuard)
  @Get('my/owner')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get current user's bookings as owner" })
  getMyBookingsAsOwner(
    @GetUser() user: User,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.bookingsService.getMyBookingsAsOwner(user.id, page, limit);
  }

  @UseGuards(JwtGuard)
  @Patch(':id/confirm')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Owner confirms a pending booking' })
  confirmBooking(@GetUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookingsService.confirmBooking(user.id, id);
  }

  @UseGuards(JwtGuard)
  @Patch(':id/decline')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Owner declines a pending booking' })
  declineBooking(
    @GetUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason?: string,
  ) {
    return this.bookingsService.declineBooking(user.id, id, reason);
  }

  @UseGuards(JwtGuard)
  @Patch(':id/cancel')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Guest cancels their own pending booking' })
  cancelBooking(@GetUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookingsService.cancelBooking(user.id, id);
  }
}
