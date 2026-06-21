import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class ExecutePaymentDto {
  @ApiProperty({ description: 'Session ID from initiate-session' })
  @IsString()
  sessionId!: string;

  @ApiProperty({ example: 100 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  invoiceValue!: number;

  @ApiPropertyOptional({ example: 'SAR' })
  @IsOptional()
  @IsString()
  displayCurrencyIso?: string;
}
