import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums/user-role.enum';
import { getPropertyTypeGroup } from '../../common/utils/property-type.util';
import { User } from '../users/entities/user.entity';
import { BookingsService } from '../bookings/bookings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { QueryListingsDto } from './dto/query-listings.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { ListingsService } from './listings.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ListingCategory } from './entities/listing-category.entity';

@ApiTags('Listings')
@Controller()
export class ListingsController {
  constructor(
    private readonly listingsService: ListingsService,
    private readonly bookingsService: BookingsService,
    @InjectRepository(ListingCategory)
    private readonly categoriesRepo: Repository<ListingCategory>,
  ) {}

  // ─── CATEGORIES ─────────────────────────────────────────────────────────────

  @Public()
  @Get('listing-categories')
  @ApiOperation({ summary: 'Get all active listing categories' })
  @ApiResponse({ status: 200, description: 'List of categories' })
  getCategories() {
    return this.categoriesRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC' },
    });
  }

  // ─── CREATE ─────────────────────────────────────────────────────────────────

  @UseGuards(JwtGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.BROKER, UserRole.HOST, UserRole.ADMIN, UserRole.USER)
  @Post('listings')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new listing' })
  @ApiResponse({ status: 201, description: 'Listing created' })
  create(@GetUser() user: User, @Body() dto: CreateListingDto) {
    return this.listingsService.createListing(user.id, dto);
  }

  // ─── LIST ────────────────────────────────────────────────────────────────────

  @Public()
  @Get('listings')
  @ApiOperation({ summary: 'Get paginated listings' })
  @ApiResponse({ status: 200, description: 'Paginated listings' })
  findAll(@Query() query: QueryListingsDto) {
    return this.listingsService.findAll(query);
  }

  // ─── MY LISTINGS ────────────────────────────────────────────────────────────

  @UseGuards(JwtGuard)
  @Get('listings/my')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get current user's listings" })
  getMyListings(@GetUser() user: User, @Query() query: QueryListingsDto) {
    return this.listingsService.getMyListings(user.id, query);
  }

  // ─── GOLDEN ─────────────────────────────────────────────────────────────────

  @Public()
  @Get('listings/golden')
  @ApiOperation({ summary: 'Get all active golden listings' })
  getGoldenListings() {
    return this.listingsService.getGoldenListings();
  }

  // ─── PROPERTY TYPE GROUP ──────────────────────────────────────────────────────

  @Public()
  @Get('listings/property-type-group/:propertyType')
  @ApiOperation({ summary: 'Get the UI field group for a property type' })
  getFieldGroupForPropertyType(@Param('propertyType') propertyType: string) {
    return { group: getPropertyTypeGroup(propertyType) };
  }

  // ─── GET ONE ────────────────────────────────────────────────────────────────

  @Public()
  @Get('listings/:id')
  @ApiOperation({ summary: 'Get a listing by ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.listingsService.findById(id);
  }

  // ─── SIMILAR ────────────────────────────────────────────────────────────────

  @Public()
  @Get('listings/:id/similar')
  @ApiOperation({ summary: 'Get similar listings' })
  getSimilar(@Param('id', ParseUUIDPipe) id: string) {
    return this.listingsService.getSimilarListings(id);
  }

  // ─── CALENDAR ───────────────────────────────────────────────────────────────

  @Public()
  @Get('listings/:id/calendar')
  @ApiOperation({ summary: 'Get blocked dates for a listing in a given month' })
  getCalendar(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
  ) {
    return this.bookingsService.getListingCalendar(id, year, month);
  }

  // ─── UPDATE ─────────────────────────────────────────────────────────────────

  @UseGuards(JwtGuard)
  @Patch('listings/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a listing' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser() user: User,
    @Body() dto: UpdateListingDto,
  ) {
    return this.listingsService.update(id, user.id, dto);
  }

  // ─── UPDATE STATUS ──────────────────────────────────────────────────────────

  @UseGuards(JwtGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('listings/:id/status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update listing status (admin only)' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser() user: User,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.listingsService.updateStatus(id, user.id, dto.status, true);
  }

  // ─── DELETE ─────────────────────────────────────────────────────────────────

  @UseGuards(JwtGuard)
  @Delete('listings/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a listing' })
  remove(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
    return this.listingsService.remove(id, user.id, user.role === UserRole.ADMIN);
  }
}
