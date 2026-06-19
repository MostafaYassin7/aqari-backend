import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Favorite } from '../engagement/entities/favorite.entity';
import { Like } from '../engagement/entities/like.entity';
import { MediaModule } from '../media/media.module';
import { PropertyAdvertisementLicense } from '../property-advertisement-licenses/entities/property-advertisement-license.entity';
import { SearchModule } from '../search/search.module';
import { User } from '../users/entities/user.entity';
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
      User,
      Favorite,
      Like,
      PropertyAdvertisementLicense,
    ]),
    SearchModule,
    MediaModule,
  ],
  controllers: [ListingsController],
  providers: [ListingsService, ListingsAlgoliaService],
  exports: [ListingsService, ListingsAlgoliaService, TypeOrmModule],
})
export class ListingsModule {}
