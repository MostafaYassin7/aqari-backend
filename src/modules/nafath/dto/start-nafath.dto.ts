import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class StartNafathDto {
  @ApiProperty({
    example: '1000000001',
    description: 'National ID, Iqama, visa or border number',
  })
  @IsString()
  @Matches(/^[1-6]\d{9}$/, {
    message: 'nationalId must be 10 digits starting with 1-6',
  })
  nationalId!: string;

  @ApiPropertyOptional({
    enum: ['ar', 'en'],
    description: 'Language of the Nafath user attributes',
  })
  @IsOptional()
  @IsIn(['ar', 'en'])
  lang?: 'ar' | 'en';
}
