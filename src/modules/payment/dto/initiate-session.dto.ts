import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class InitiateSessionDto {
  @ApiProperty({ example: 100 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  invoiceAmount!: number;

  @ApiPropertyOptional({ example: 'SAR' })
  @IsOptional()
  @IsString()
  currencyIso?: string;
}
