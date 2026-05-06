import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { CrmService } from './crm.service';
import { CreateClientDto } from './dto/create-client.dto';
import { CreateDealDto } from './dto/create-deal.dto';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ClientPriority } from './entities/client.entity';

const CRM_ROLES = [UserRole.BROKER, UserRole.OWNER, UserRole.HOST, UserRole.ADMIN];

@ApiTags('CRM')
@ApiBearerAuth()
@UseGuards(JwtGuard, RolesGuard)
@Controller('crm')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  // ─── CLIENTS ─────────────────────────────────────────────────────────────────

  @Roles(...CRM_ROLES)
  @Get('clients')
  @ApiOperation({ summary: 'Get my clients' })
  getClients(
    @GetUser() user: User,
    @Query('priority') priority?: ClientPriority,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.crmService.getClients(
      user.id,
      priority,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @Roles(...CRM_ROLES)
  @Post('clients')
  @ApiOperation({ summary: 'Create a client' })
  createClient(@GetUser() user: User, @Body() dto: CreateClientDto) {
    return this.crmService.createClient(user.id, dto);
  }

  @Roles(...CRM_ROLES)
  @Patch('clients/:id')
  @ApiOperation({ summary: 'Update a client' })
  updateClient(
    @GetUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.crmService.updateClient(user.id, id, dto);
  }

  @Roles(...CRM_ROLES)
  @Delete('clients/:id')
  @ApiOperation({ summary: 'Delete a client' })
  deleteClient(@GetUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.crmService.deleteClient(user.id, id);
  }

  // ─── REMINDERS ───────────────────────────────────────────────────────────────

  @Roles(...CRM_ROLES)
  @Get('reminders/upcoming')
  @ApiOperation({ summary: 'Get upcoming reminders (next 48h)' })
  getUpcomingReminders(@GetUser() user: User) {
    return this.crmService.getUpcomingReminders(user.id);
  }

  @Roles(...CRM_ROLES)
  @Post('clients/:clientId/reminders')
  @ApiOperation({ summary: 'Add a reminder to a client' })
  createReminder(
    @GetUser() user: User,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: CreateReminderDto,
  ) {
    return this.crmService.createReminder(user.id, clientId, dto);
  }

  @Roles(...CRM_ROLES)
  @Patch('reminders/:id/done')
  @ApiOperation({ summary: 'Mark a reminder as done' })
  markReminderDone(@GetUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.crmService.markReminderDone(user.id, id);
  }

  @Roles(...CRM_ROLES)
  @Delete('reminders/:id')
  @ApiOperation({ summary: 'Delete a reminder' })
  deleteReminder(@GetUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.crmService.deleteReminder(user.id, id);
  }

  // ─── DEALS ───────────────────────────────────────────────────────────────────

  @Roles(...CRM_ROLES)
  @Get('deals')
  @ApiOperation({ summary: 'Get my deals' })
  getDeals(
    @GetUser() user: User,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.crmService.getDeals(
      user.id,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @Roles(...CRM_ROLES)
  @Post('deals')
  @ApiOperation({ summary: 'Create a deal' })
  createDeal(@GetUser() user: User, @Body() dto: CreateDealDto) {
    return this.crmService.createDeal(user.id, dto);
  }

  @Roles(...CRM_ROLES)
  @Delete('deals/:id')
  @ApiOperation({ summary: 'Delete a deal' })
  deleteDeal(@GetUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.crmService.deleteDeal(user.id, id);
  }
}
