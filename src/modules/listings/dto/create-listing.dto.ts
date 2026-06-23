import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Facade } from '../../../common/enums/facade.enum';
import { ListingType } from '../../../common/enums/listing-type.enum';
import { PropertyType } from '../../../common/enums/property-type.enum';
import { UsageType } from '../../../common/enums/usage-type.enum';

export class CreateListingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty()
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ enum: PropertyType })
  @IsEnum(PropertyType)
  propertyType!: PropertyType;

  @ApiProperty({ enum: ListingType })
  @IsEnum(ListingType)
  listingType!: ListingType;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  totalPrice!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  area!: number;

  @ApiPropertyOptional({ enum: UsageType })
  @IsEnum(UsageType)
  @IsOptional()
  usageType?: UsageType;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  bedrooms?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  livingRooms?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  bathrooms?: number;

  @ApiPropertyOptional({ enum: Facade })
  @IsEnum(Facade)
  @IsOptional()
  facade?: Facade;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  floor?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  propertyAge?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  streetWidth?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  commission?: boolean;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  commissionPercent?: number;

  // Features
  @ApiPropertyOptional() @IsBoolean() @IsOptional() hasWater?: boolean;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() hasElectricity?: boolean;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() hasSewage?: boolean;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() hasPrivateRoof?: boolean;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isInVilla?: boolean;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() hasTwoEntrances?: boolean;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() hasSpecialEntrance?: boolean;

  // Checklist
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isFurnished?: boolean;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() hasKitchen?: boolean;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() hasExtraUnit?: boolean;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() hasCarEntrance?: boolean;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() hasElevator?: boolean;

  // Location
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  city!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  district?: string;

  @ApiProperty()
  @IsNumber()
  latitude!: number;

  @ApiProperty()
  @IsNumber()
  longitude!: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ type: [String], description: 'GCP URLs from /media/upload' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaUrls?: string[];

  // نوع المُعلن — used to enforce license requirement per type
  @ApiPropertyOptional({ enum: ['owner', 'agent', 'broker', 'host'] })
  @IsString()
  @IsIn(['owner', 'agent', 'broker', 'host'])
  @IsOptional()
  advertiserType?: string;

  // معرّف ترخيص الإعلان العقاري
  // UUID of the PropertyAdvertisementLicense record created before this listing.
  // Required for owner, agent, and broker advertiser types.
  // Omitted for host — host listings publish immediately without review.
  @ApiPropertyOptional({ description: 'معرّف ترخيص الإعلان العقاري — from POST /property-advertisement-licenses' })
  @IsUUID()
  @IsOptional()
  licenseId?: string;
}
