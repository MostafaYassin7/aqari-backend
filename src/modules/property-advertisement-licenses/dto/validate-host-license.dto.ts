import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ValidateHostLicenseDto {
  // رقم رخصة وزارة السياحة
  // Tourism license number issued by
  // Saudi Ministry of Tourism
  // Required: YES
  @ApiProperty({ description: 'رقم رخصة وزارة السياحة السعودية', example: 'TL-123456' })
  @IsNotEmpty()
  @IsString()
  tourismLicenseNumber!: string;
}
