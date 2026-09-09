import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';

interface SendMessagePayload {
  chatId: string;
  content: string;
}

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/chat' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly chatService: ChatService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const rawToken =
        (client.handshake.auth as Record<string, string>)['token'] ??
        client.handshake.headers['authorization'] ??
        '';
      const token = String(rawToken)
        .replace(/^Bearer\s+/i, '')
        .trim();

      const payload = this.jwtService.verify<{ sub: string }>(token);
      client.data = { userId: payload.sub };
      await client.join(payload.sub);
      this.logger.log(`Chat connected: ${client.id} → room ${payload.sub}`);
    } catch {
      this.logger.warn(`Unauthorized chat connection: ${client.id}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Chat disconnected: ${client.id}`);
  }

  @SubscribeMessage('join_chat')
  async handleJoinChat(client: Socket, chatId: string) {
    const userId = (client.data as { userId: string }).userId;
    await this.chatService.markMessagesRead(chatId, userId);
    await client.join(chatId);
    this.server.to(chatId).emit('messages_read', { chatId, userId });
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(client: Socket, payload: SendMessagePayload) {
    const userId = (client.data as { userId: string }).userId;
    const message = await this.chatService.sendMessage(
      payload.chatId,
      userId,
      payload.content,
    );

    this.server.to(payload.chatId).emit('new_message', {
      message,
      chatId: payload.chatId,
    });

    return message;
  }

  @SubscribeMessage('typing')
  handleTyping(client: Socket, chatId: string) {
    const userId = (client.data as { userId: string }).userId;
    client.to(chatId).emit('user_typing', { userId, chatId });
  }

  @SubscribeMessage('leave_chat')
  async handleLeaveChat(client: Socket, chatId: string) {
    await client.leave(chatId);
  }
}
