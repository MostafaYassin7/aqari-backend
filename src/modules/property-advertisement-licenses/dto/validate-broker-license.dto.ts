import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class ValidateBrokerLicenseDto {
  // رقم ترخيص الإعلان
  // Ad license number issued by REGA
  // Required: YES
  @ApiProperty({ description: 'رقم ترخيص الإعلان الصادر من الهيئة العامة للعقار', example: '7200927723' })
  @IsNotEmpty()
  @IsString()
  adLicenseNumber!: string;

  // نوع هوية مالك العقار
  // Allowed values:
  //   'national_id'             → هوية وطنية
  //   'commercial_registration' → سجل تجاري
  // Required: YES
  @ApiProperty({
    description: 'نوع هوية مالك العقار',
    enum: ['national_id', 'commercial_registration'],
    example: 'national_id',
  })
  @IsNotEmpty()
  @IsIn(['national_id', 'commercial_registration'])
  ownerIdType!: string;

  // رقم هوية مالك العقار
  // Required: YES
  @ApiProperty({ description: 'رقم هوية مالك العقار', example: '1098765432' })
  @IsNotEmpty()
  @IsString()
  ownerIdNumber!: string;
}
