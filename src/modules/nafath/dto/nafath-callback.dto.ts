import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

/** Body Nafath POSTs to our callback. Validated leniently in the controller (extra fields allowed). */
export class NafathCallbackDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @IsNotEmpty()
  transId!: string;

  @IsUUID()
  requestId!: string;
}
