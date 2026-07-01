import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional } from 'class-validator';

export class CheckAvailabilityDto {
  @ApiPropertyOptional({ description: 'YYYY-MM-DD (daily rental)' })
  @IsOptional()
  @IsDateString()
  checkInDate?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD (daily rental)' })
  @IsOptional()
  @IsDateString()
  checkOutDate?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD (event hall)' })
  @IsOptional()
  @IsDateString()
  eventDate?: string;

  @ApiPropertyOptional({ enum: ['morning', 'evening', 'full_day'] })
  @IsOptional()
  @IsIn(['morning', 'evening', 'full_day'])
  timeSlot?: string;
}
