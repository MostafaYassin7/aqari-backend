import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ListingType } from '../../../common/enums/listing-type.enum';
import { PropertyType } from '../../../common/enums/property-type.enum';

export class SearchListingsDto {
  @ApiPropertyOptional() @IsString() @IsOptional() query?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() city?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() district?: string;

  @ApiPropertyOptional({ enum: PropertyType })
  @IsEnum(PropertyType)
  @IsOptional()
  propertyType?: PropertyType;

  @ApiPropertyOptional({ enum: PropertyType })
  @IsEnum(PropertyType)
  @IsOptional()
  excludePropertyType?: PropertyType;

  @ApiPropertyOptional({ enum: ListingType })
  @IsEnum(ListingType)
  @IsOptional()
  listingType?: ListingType;

  @ApiPropertyOptional() @Type(() => Number) @IsNumber() @IsOptional() priceFrom?: number;
  @ApiPropertyOptional() @Type(() => Number) @IsNumber() @IsOptional() priceTo?: number;
  @ApiPropertyOptional() @Type(() => Number) @IsNumber() @IsOptional() areaFrom?: number;
  @ApiPropertyOptional() @Type(() => Number) @IsNumber() @IsOptional() areaTo?: number;
  @ApiPropertyOptional() @Type(() => Number) @IsNumber() @IsOptional() bedrooms?: number;
  @ApiPropertyOptional() @Type(() => Number) @IsNumber() @IsOptional() maxGuests?: number;

  @ApiPropertyOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() @IsOptional() isFurnished?: boolean;
  @ApiPropertyOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() @IsOptional() hasElevator?: boolean;
  @ApiPropertyOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() @IsOptional() hasWater?: boolean;
  @ApiPropertyOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() @IsOptional() hasElectricity?: boolean;

  @ApiPropertyOptional({ enum: ['newest', 'oldest', 'price_asc', 'price_desc'] })
  @IsString()
  @IsOptional()
  sortBy?: 'newest' | 'oldest' | 'price_asc' | 'price_desc';

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  limit?: number = 20;
}
