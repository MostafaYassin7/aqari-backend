import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import {
  NotificationReferenceType,
  NotificationType,
} from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/entities/user.entity';
import { ListingsService } from '../listings/listings.service';
import { Chat } from './entities/chat.entity';
import { Message } from './entities/message.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Chat)
    private readonly chatsRepo: Repository<Chat>,
    @InjectRepository(Message)
    private readonly messagesRepo: Repository<Message>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly listingsService: ListingsService,
  ) {}

  // ─── FIND OR CREATE ──────────────────────────────────────────────────────────

  async findOrCreateChat(
    participantA: string,
    participantB: string,
    listingId?: string | null,
  ): Promise<Chat> {
    const listingCondition = listingId ?? null;

    const existing = await this.chatsRepo
      .createQueryBuilder('c')
      .where(
        '((c.participantA = :a AND c.participantB = :b) OR (c.participantA = :b AND c.participantB = :a))',
        { a: participantA, b: participantB },
      )
      .andWhere(
        listingCondition
          ? 'c.listingId = :listingId'
          : 'c.listingId IS NULL',
        listingCondition ? { listingId: listingCondition } : {},
      )
      .getOne();

    if (existing) return existing;

    const chat = this.chatsRepo.create({
      participantA,
      participantB,
      listingId: listingCondition,
    });
    const saved = await this.chatsRepo.save(chat);

    if (listingCondition) {
      this.listingsService.incrementMessageCount(listingCondition).catch(() => null);
    }

    return saved;
  }

  // ─── USER CHATS ──────────────────────────────────────────────────────────────

  async getUserChats(userId: string): Promise<unknown[]> {
    const chats = await this.chatsRepo
      .createQueryBuilder('c')
      .where(
        '(c.participantA = :userId AND c.isDeletedByA = false) OR (c.participantB = :userId AND c.isDeletedByB = false)',
        { userId },
      )
      .orderBy('c.lastMessageAt', 'DESC', 'NULLS LAST')
      .getMany();

    return Promise.all(
      chats.map(async (chat) => {
        const otherId =
          chat.participantA === userId ? chat.participantB : chat.participantA;

        const [other, unreadCount] = await Promise.all([
          this.usersRepo.findOne({
            where: { id: otherId },
            select: ['id', 'name', 'profilePhoto', 'phone'],
          }),
          this.messagesRepo.count({
            where: { chatId: chat.id, isRead: false, senderId: Not(userId) },
          }),
        ]);

        return { ...chat, otherParticipant: other, unreadCount };
      }),
    );
  }

  // ─── MESSAGES ────────────────────────────────────────────────────────────────

  async getChatMessages(
    chatId: string,
    userId: string,
    page = 1,
    limit = 50,
  ): Promise<{ data: Message[]; total: number; page: number }> {
    const chat = await this.chatsRepo.findOne({ where: { id: chatId } });
    if (!chat) throw new NotFoundException('Chat not found');
    if (chat.participantA !== userId && chat.participantB !== userId)
      throw new ForbiddenException('Not a participant');

    const [data, total] = await this.messagesRepo.findAndCount({
      where: { chatId },
      order: { createdAt: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page };
  }

  // ─── DELETE CHAT ─────────────────────────────────────────────────────────────

  async deleteChat(chatId: string, userId: string): Promise<void> {
    const chat = await this.chatsRepo.findOne({ where: { id: chatId } });
    if (!chat) throw new NotFoundException('Chat not found');
    if (chat.participantA !== userId && chat.participantB !== userId)
      throw new ForbiddenException('Not a participant');

    if (chat.participantA === userId) {
      await this.chatsRepo.update(chatId, { isDeletedByA: true });
    } else {
      await this.chatsRepo.update(chatId, { isDeletedByB: true });
    }
  }

  // ─── MARK READ ───────────────────────────────────────────────────────────────

  async markMessagesRead(chatId: string, userId: string): Promise<void> {
    await this.messagesRepo.update(
      { chatId, isRead: false, senderId: Not(userId) },
      { isRead: true, readAt: new Date() },
    );
  }

  // ─── SEND MESSAGE ────────────────────────────────────────────────────────────

  async sendMessage(
    chatId: string,
    senderId: string,
    content: string,
  ): Promise<Message> {
    const chat = await this.chatsRepo.findOne({ where: { id: chatId } });
    if (!chat) throw new NotFoundException('Chat not found');
    if (chat.participantA !== senderId && chat.participantB !== senderId)
      throw new ForbiddenException('Not a participant');

    const message = this.messagesRepo.create({ chatId, senderId, content });
    const saved = await this.messagesRepo.save(message);

    const recipientId =
      chat.participantA === senderId ? chat.participantB : chat.participantA;

    await this.chatsRepo.update(chatId, {
      lastMessage: content.substring(0, 100),
      lastMessageAt: new Date(),
      ...(chat.participantA === senderId
        ? { isDeletedByB: false }
        : { isDeletedByA: false }),
    });

    const sender = await this.usersRepo.findOne({ where: { id: senderId } });
    this.notificationsService
      .createAndSend(
        recipientId,
        NotificationType.NEW_MESSAGE,
        `New message from ${sender?.name ?? 'Someone'}`,
        content.substring(0, 80),
        NotificationReferenceType.CHAT,
        chatId,
      )
      .catch(() => null);

    return saved;
  }
}
