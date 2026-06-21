import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { User } from '../users/entities/user.entity';
import { ExecutePaymentDto } from './dto/execute-payment.dto';
import { InitiateSessionDto } from './dto/initiate-session.dto';
import { PaymentService } from './payment.service';

@ApiTags('Payment')
@UseGuards(JwtGuard)
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('initiate-session')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initiate a MyFatoorah payment session' })
  initiateSession(@Body() dto: InitiateSessionDto) {
    return this.paymentService.initiateSession(dto.invoiceAmount, dto.currencyIso);
  }

  @Post('execute')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Execute wallet top-up payment' })
  executeTopUp(@GetUser() user: User, @Body() dto: ExecutePaymentDto) {
    return this.paymentService.executeTopUp(user, dto);
  }

  @Post('webhook')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'MyFatoorah webhook — payment status changes' })
  async webhook(
    @Body() body: any,
    @Headers('x-myfatoorah-signature') signature?: string,
  ) {
    await this.paymentService.handleWebhook(body, signature);
    return { message: 'Webhook received successfully' };
  }
}
