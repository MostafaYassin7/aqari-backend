import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { PushTokenPlatform } from '../entities/push-token.entity';

export class RegisterPushTokenDto {
  @ApiProperty({ example: 'fcm-token-abc123' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ enum: PushTokenPlatform })
  @IsEnum(PushTokenPlatform)
  platform!: PushTokenPlatform;
}
