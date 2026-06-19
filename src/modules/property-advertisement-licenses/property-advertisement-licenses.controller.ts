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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { CreatePropertyAdvertisementLicenseDto } from './dto/create-property-advertisement-license.dto';
import { UpdateLicenseReviewStatusDto } from './dto/update-license-review-status.dto';
import { PropertyAdvertisementLicensesService } from './property-advertisement-licenses.service';

@ApiTags('Property Advertisement Licenses')
@ApiBearerAuth()
@Controller('property-advertisement-licenses')
export class PropertyAdvertisementLicensesController {
  constructor(
    private readonly service: PropertyAdvertisementLicensesService,
  ) {}

  // ── POST /property-advertisement-licenses ─────────────────────────────────────
  // إنشاء طلب ترخيص إعلان عقاري جديد

  @UseGuards(JwtGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.BROKER, UserRole.HOST, UserRole.USER)
  @Post()
  @ApiOperation({ summary: 'إنشاء طلب ترخيص إعلان عقاري — Submit a new license request' })
  @ApiResponse({ status: 201, description: 'License created, pending admin review' })
  create(
    @GetUser() user: User,
    @Body() dto: CreatePropertyAdvertisementLicenseDto,
  ) {
    return this.service.createLicense(user.id, dto);
  }

  // ── GET /property-advertisement-licenses/my ───────────────────────────────────
  // طلباتي — view my own license requests

  @UseGuards(JwtGuard)
  @Get('my')
  @ApiOperation({ summary: 'طلباتي — Get all my license requests' })
  @ApiResponse({ status: 200, description: 'Array of the current user\'s licenses' })
  getMyLicenses(@GetUser() user: User) {
    return this.service.getMyLicenses(user.id);
  }

  // ── GET /property-advertisement-licenses/pending ──────────────────────────────
  // قائمة الطلبات المعلقة — admin: paginated pending licenses

  @UseGuards(JwtGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('pending')
  @ApiOperation({ summary: 'قائمة الطلبات المعلقة — Admin: paginated pending licenses' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiResponse({ status: 200, description: 'Paginated list of pending licenses with user and listing info' })
  getPendingLicenses(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.service.getPendingLicenses(page, limit);
  }

  // ── GET /property-advertisement-licenses/pending/count ────────────────────────
  // عدد الطلبات المعلقة — admin dashboard badge count

  @UseGuards(JwtGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('pending/count')
  @ApiOperation({ summary: 'عدد الطلبات المعلقة — Admin dashboard badge count' })
  @ApiResponse({ status: 200, description: '{ count: number }' })
  getPendingCount() {
    return this.service.getPendingLicensesCount();
  }

  // ── PATCH /property-advertisement-licenses/:id/review ─────────────────────────
  // مراجعة الطلب — admin approves or rejects a license

  @UseGuards(JwtGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/review')
  @ApiOperation({ summary: 'مراجعة الطلب — Admin: approve or reject a license' })
  @ApiResponse({ status: 200, description: 'License reviewed, listing status updated' })
  @ApiResponse({ status: 400, description: 'Rejection reason required when rejecting' })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser() admin: User,
    @Body() dto: UpdateLicenseReviewStatusDto,
  ) {
    return this.service.updateReviewStatus(id, admin.id, dto);
  }
}
