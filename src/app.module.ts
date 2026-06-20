import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from './config/database.config';
import { AuthModule } from './modules/auth/auth.module';
import { ChatModule } from './modules/chat/chat.module';
import { MediaModule } from './modules/media/media.module';
import { EngagementModule } from './modules/engagement/engagement.module';
import { ListingsModule } from './modules/listings/listings.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { CrmModule } from './modules/crm/crm.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { PropertyAdvertisementLicensesModule } from './modules/property-advertisement-licenses/property-advertisement-licenses.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { SearchModule } from './modules/search/search.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync(databaseConfig),
    UsersModule,
    AuthModule,
    ListingsModule,
    SearchModule,
    EngagementModule,
    ProjectsModule,
    NotificationsModule,
    ChatModule,
    WalletModule,
    MediaModule,
    PromotionsModule,
    CrmModule,
    WhatsappModule,
    IntegrationsModule,
    PropertyAdvertisementLicensesModule,
  ],
})
export class AppModule {}
