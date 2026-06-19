import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateLicenseReviewStatusDto {
  // حالة المراجعة — the admin's decision on this license request.
  // 'approved' → تمت الموافقة — listing will be published
  // 'rejected' → مرفوض       — listing will be paused, user notified
  @ApiProperty({
    description: 'حالة المراجعة',
    enum: ['approved', 'rejected'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['approved', 'rejected'])
  reviewStatus!: string;

  // سبب الرفض — written by admin when rejecting.
  // REQUIRED when reviewStatus = 'rejected' (validated in service).
  // Sent to the user as the notification body so they know what to fix.
  // Optional at DTO level; service throws 400 if missing on rejection.
  @ApiPropertyOptional({
    description: 'سبب الرفض — مطلوب عند رفض الطلب',
    example: 'رقم الصك غير صحيح',
  })
  @IsString()
  @IsOptional()
  rejectionReason?: string;
}
