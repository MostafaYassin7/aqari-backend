import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { ClientPriority } from './entities/client.entity';
import { Client } from './entities/client.entity';
import { Deal } from './entities/deal.entity';
import { Reminder } from './entities/reminder.entity';
import { CreateClientDto } from './dto/create-client.dto';
import { CreateDealDto } from './dto/create-deal.dto';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class CrmService {
  constructor(
    @InjectRepository(Client)
    private readonly clientsRepo: Repository<Client>,
    @InjectRepository(Reminder)
    private readonly remindersRepo: Repository<Reminder>,
    @InjectRepository(Deal)
    private readonly dealsRepo: Repository<Deal>,
  ) {}

  // ─── CLIENTS ─────────────────────────────────────────────────────────────────

  async getClients(
    brokerId: string,
    priority?: ClientPriority,
    page = 1,
    limit = 20,
  ): Promise<{ data: unknown[]; total: number; page: number; pages: number }> {
    const where: Record<string, unknown> = { brokerId };
    if (priority) where['priority'] = priority;

    const [clients, total] = await this.clientsRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const data = await Promise.all(
      clients.map(async (client) => {
        const upcomingReminders = await this.remindersRepo.count({
          where: { clientId: client.id, isDone: false },
        });
        return { ...client, upcomingReminders };
      }),
    );

    return { data, total, page, pages: Math.ceil(total / limit) };
  }

  async createClient(brokerId: string, dto: CreateClientDto): Promise<unknown> {
    const client = await this.clientsRepo.save(
      this.clientsRepo.create({
        brokerId,
        name: dto.name,
        phone: dto.phone,
        adNumber: dto.adNumber ?? null,
        priority: dto.priority ?? ClientPriority.MEDIUM,
        clientDesire: dto.clientDesire ?? null,
        nextStep: dto.nextStep ?? null,
        notes: dto.notes ?? null,
      }),
    );

    if (dto.reminder) {
      await this.remindersRepo.save(
        this.remindersRepo.create({
          clientId: client.id,
          brokerId,
          reminderAt: new Date(dto.reminder.reminderAt),
          note: dto.reminder.note ?? null,
        }),
      );
    }

    return client;
  }

  async updateClient(
    brokerId: string,
    clientId: string,
    dto: UpdateClientDto,
  ): Promise<Client> {
    const client = await this.clientsRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Client not found');
    if (client.brokerId !== brokerId) throw new ForbiddenException('Not your client');

    await this.clientsRepo.update(clientId, dto as Partial<Client>);
    return this.clientsRepo.findOneOrFail({ where: { id: clientId } });
  }

  async deleteClient(brokerId: string, clientId: string): Promise<void> {
    const client = await this.clientsRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Client not found');
    if (client.brokerId !== brokerId) throw new ForbiddenException('Not your client');
    await this.clientsRepo.softDelete(clientId);
  }

  // ─── REMINDERS ───────────────────────────────────────────────────────────────

  async createReminder(
    brokerId: string,
    clientId: string,
    dto: CreateReminderDto,
  ): Promise<Reminder> {
    const client = await this.clientsRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Client not found');
    if (client.brokerId !== brokerId) throw new ForbiddenException('Not your client');

    return this.remindersRepo.save(
      this.remindersRepo.create({
        clientId,
        brokerId,
        reminderAt: new Date(dto.reminderAt),
        note: dto.note ?? null,
      }),
    );
  }

  async markReminderDone(brokerId: string, reminderId: string): Promise<Reminder> {
    const reminder = await this.remindersRepo.findOne({ where: { id: reminderId } });
    if (!reminder) throw new NotFoundException('Reminder not found');
    if (reminder.brokerId !== brokerId) throw new ForbiddenException('Not your reminder');

    reminder.isDone = true;
    return this.remindersRepo.save(reminder);
  }

  async deleteReminder(brokerId: string, reminderId: string): Promise<void> {
    const reminder = await this.remindersRepo.findOne({ where: { id: reminderId } });
    if (!reminder) throw new NotFoundException('Reminder not found');
    if (reminder.brokerId !== brokerId) throw new ForbiddenException('Not your reminder');
    await this.remindersRepo.delete(reminderId);
  }

  async getUpcomingReminders(brokerId: string): Promise<Reminder[]> {
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    return this.remindersRepo.find({
      where: {
        brokerId,
        isDone: false,
        reminderAt: Between(now, in48h),
      },
      relations: { client: true },
      order: { reminderAt: 'ASC' },
    });
  }

  // ─── DEALS ───────────────────────────────────────────────────────────────────

  async getDeals(
    brokerId: string,
    page = 1,
    limit = 20,
  ): Promise<{ data: Deal[]; total: number; page: number; pages: number }> {
    const [data, total] = await this.dealsRepo.findAndCount({
      where: { brokerId },
      relations: { listing: true },
      order: { dealDate: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, pages: Math.ceil(total / limit) };
  }

  async createDeal(brokerId: string, dto: CreateDealDto): Promise<Deal> {
    return this.dealsRepo.save(
      this.dealsRepo.create({
        brokerId,
        listingId: dto.listingId ?? null,
        buyerName: dto.buyerName,
        dealValue: dto.dealValue.toString(),
        dealDate: dto.dealDate,
        notes: dto.notes ?? null,
      }),
    );
  }

  async deleteDeal(brokerId: string, dealId: string): Promise<void> {
    const deal = await this.dealsRepo.findOne({ where: { id: dealId } });
    if (!deal) throw new NotFoundException('Deal not found');
    if (deal.brokerId !== brokerId) throw new ForbiddenException('Not your deal');
    await this.dealsRepo.softDelete(dealId);
  }
}
