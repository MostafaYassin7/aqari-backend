import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreatePropertyAdvertisementLicenseDto {
  // نوع المُعلن — determines which fields are required for this license.
  // Validation of per-type required fields is handled in the service.
  @ApiProperty({
    description: 'نوع المُعلن',
    enum: ['owner', 'agent', 'broker', 'host'],
    example: 'owner',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['owner', 'agent', 'broker', 'host'])
  advertiserType!: string;

  // نوع وثيقة ملكية العقار — used by owner and agent
  @ApiPropertyOptional({
    description: 'نوع وثيقة ملكية العقار',
    enum: ['electronic_deed', 'property_number', 'land_registry', 'other'],
  })
  @IsString()
  @IsOptional()
  @IsIn(['electronic_deed', 'property_number', 'land_registry', 'other'])
  ownershipDocumentType?: string;

  // رقم الوثيقة — رقم الصك أو رقم العقار أو رقم السجل العيني
  @ApiPropertyOptional({ description: 'رقم وثيقة الملكية' })
  @IsString()
  @IsOptional()
  ownershipDocumentNumber?: string;

  // نوع هوية مالك العقار — used by owner, agent, broker
  @ApiPropertyOptional({
    description: 'نوع هوية مالك العقار',
    enum: ['national_id', 'commercial_registration', 'unified_700'],
  })
  @IsString()
  @IsOptional()
  @IsIn(['national_id', 'commercial_registration', 'unified_700'])
  propertyOwnerIdType?: string;

  // تاريخ ميلاد المالك — required for individuals (national_id) only
  @ApiPropertyOptional({ description: 'تاريخ ميلاد المالك', example: '1990-01-15' })
  @IsString()
  @IsOptional()
  propertyOwnerBirthDate?: string;

  // رقم الهوية الوطنية للمالك — filled ONLY when propertyOwnerIdType = 'national_id'
  @ApiPropertyOptional({ description: 'رقم الهوية الوطنية للمالك (عند نوع الهوية: هوية وطنية)' })
  @IsString()
  @IsOptional()
  ownerNationalIdNumber?: string;

  // رقم السجل التجاري للمنشأة المالكة — filled ONLY when propertyOwnerIdType = 'commercial_registration'
  @ApiPropertyOptional({ description: 'رقم السجل التجاري للمنشأة المالكة للعقار (عند نوع الهوية: سجل تجاري)' })
  @IsString()
  @IsOptional()
  ownerCommercialRegNumber?: string;

  // الرقم الموحد 700 للمنشأة المالكة — filled ONLY when propertyOwnerIdType = 'unified_700'
  @ApiPropertyOptional({ description: 'الرقم الموحد 700 للمنشأة المالكة للعقار (عند نوع الهوية: الرقم الموحد 700)' })
  @IsString()
  @IsOptional()
  ownerUnifiedNumber?: string;

  // هل التاريخ بالتقويم الهجري؟
  @ApiPropertyOptional({ description: 'هل تاريخ الميلاد بالتقويم الهجري؟', default: true })
  @IsBoolean()
  @IsOptional()
  isHijriCalendar?: boolean;

  // رقم جوال المالك
  @ApiPropertyOptional({ description: 'رقم جوال المالك' })
  @IsString()
  @IsOptional()
  propertyOwnerPhone?: string;

  // رقم هوية أحد الملاك — when property has multiple owners
  @ApiPropertyOptional({ description: 'رقم هوية أحد الملاك (عند وجود ملاك متعددين)' })
  @IsString()
  @IsOptional()
  oneOfOwnersNationalId?: string;

  // رقم الوكالة الرسمية (وزارة العدل) — agent ONLY
  @ApiPropertyOptional({ description: 'رقم الوكالة الرسمية — صادرة من وزارة العدل (للوكيل فقط)' })
  @IsString()
  @IsOptional()
  powerOfAttorneyNumber?: string;

  // رقم الهوية الوطنية للوكيل — agent ONLY
  @ApiPropertyOptional({ description: 'رقم الهوية الوطنية للوكيل' })
  @IsString()
  @IsOptional()
  agentNationalIdNumber?: string;

  // تاريخ ميلاد الوكيل — agent ONLY
  @ApiPropertyOptional({ description: 'تاريخ ميلاد الوكيل', example: '1985-06-20' })
  @IsString()
  @IsOptional()
  agentBirthDate?: string;

  // رقم جوال الوكيل — agent ONLY
  @ApiPropertyOptional({ description: 'رقم جوال الوكيل' })
  @IsString()
  @IsOptional()
  agentPhone?: string;

}
