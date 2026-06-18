import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '../../../common/enums/user-role.enum';

const ALLOWED_ROLES = [
  UserRole.USER,
  UserRole.OWNER,
  UserRole.BROKER,
  UserRole.HOST,
] as const;
///sss

export class CompleteProfileDto {
  @ApiProperty({ example: 'Ahmed' })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiPropertyOptional({ example: 'ahmed@example.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({ enum: ALLOWED_ROLES, example: UserRole.USER })
  @IsEnum(ALLOWED_ROLES)
  role!: (typeof ALLOWED_ROLES)[number];
}
