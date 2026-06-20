import { Module } from '@nestjs/common';
import { RegaService } from './rega.service';
import { TourismService } from './tourism.service';

@Module({
  providers: [RegaService, TourismService],
  exports: [RegaService, TourismService],
})
export class IntegrationsModule {}
