import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LinkNafathDto {
  @ApiProperty({
    description:
      'linkToken returned by GET /auth/nafath/status when linkRequired is true',
  })
  @IsString()
  @IsNotEmpty()
  linkToken!: string;
}
