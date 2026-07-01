import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingsModule } from '../bookings/bookings.module';
import { Favorite } from '../engagement/entities/favorite.entity';
import { Like } from '../engagement/entities/like.entity';
import { MediaModule } from '../media/media.module';
import { PropertyAdvertisementLicense } from '../property-advertisement-licenses/entities/property-advertisement-license.entity';
import { SearchModule } from '../search/search.module';
import { User } from '../users/entities/user.entity';
import { ListingAvailability } from './entities/listing-availability.entity';
import { ListingCategory } from './entities/listing-category.entity';
import { ListingMedia } from './entities/listing-media.entity';
import { Listing } from './entities/listing.entity';
import { ListingsAlgoliaService } from './listings-algolia.service';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Listing,
      ListingCategory,
      ListingMedia,
      ListingAvailability,
      User,
      Favorite,
      Like,
      PropertyAdvertisementLicense,
    ]),
    SearchModule,
    MediaModule,
    BookingsModule,
  ],
  controllers: [ListingsController],
  providers: [ListingsService, ListingsAlgoliaService],
  exports: [ListingsService, ListingsAlgoliaService, TypeOrmModule],
})
export class ListingsModule {}
