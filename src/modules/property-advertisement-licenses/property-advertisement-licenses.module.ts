import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ListingsModule } from '../listings/listings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/entities/user.entity';
import { PropertyAdvertisementLicense } from './entities/property-advertisement-license.entity';
import { PropertyAdvertisementLicensesController } from './property-advertisement-licenses.controller';
import { PropertyAdvertisementLicensesService } from './property-advertisement-licenses.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PropertyAdvertisementLicense, User]),
    // ListingsModule exports ListingsAlgoliaService and TypeOrmModule (Listing repo)
    ListingsModule,
    // NotificationsModule exports NotificationsService
    NotificationsModule,
  ],
  controllers: [PropertyAdvertisementLicensesController],
  providers: [PropertyAdvertisementLicensesService],
  exports: [PropertyAdvertisementLicensesService, TypeOrmModule],
})
export class PropertyAdvertisementLicensesModule {}
